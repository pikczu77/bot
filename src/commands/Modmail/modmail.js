import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { respond, requireGuild, requirePermission, userError, truncate } from '../../utils/featureKit.js';
import { ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    closeThread,
    getModmailConfig,
    getThreadByChannel,
    isModmailStaff,
    openThread,
    relayToUser,
    removeSnippet,
    setSnippet,
    updateModmailConfig,
} from '../../services/modmailService.js';
import { t } from '../../i18n/index.js';

const ADMIN_SUBCOMMANDS = new Set(['block', 'unblock', 'snippet-add', 'snippet-remove']);

async function requireThread(interaction) {
    const thread = await getThreadByChannel(interaction.guildId, interaction.channelId);
    if (!thread) throw userError(t('Use this inside a modmail conversation channel.'));
    return thread;
}

export default {
    data: new SlashCommandBuilder()
        .setName('modmail')
        .setDescription('Private conversations between members and staff through bot DMs')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand((sub) =>
            sub
                .setName('kontakt')
                .setDescription('Start a conversation with a member')
                .addUserOption((option) => option.setName('user').setDescription('Member to contact').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('odpowiedz')
                .setDescription('Answer in this conversation')
                .addStringOption((option) => option.setName('message').setDescription('Your answer').setRequired(true).setMaxLength(1900))
                .addBooleanOption((option) => option.setName('anonymous').setDescription('Send without your name')),
        )
        .addSubcommand((sub) =>
            sub
                .setName('zamknij')
                .setDescription('Close this conversation')
                .addStringOption((option) => option.setName('reason').setDescription('Reason shown to the member').setMaxLength(500)),
        )
        .addSubcommand((sub) =>
            sub.setName('zablokuj').setDescription('Stop a member from using modmail')
                .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('odblokuj').setDescription('Let a member use modmail again')
                .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('szablon-dodaj').setDescription('Save a ready-made answer')
                .addStringOption((option) => option.setName('name').setDescription('Short name').setRequired(true).setMaxLength(32))
                .addStringOption((option) => option.setName('text').setDescription('The answer').setRequired(true).setMaxLength(1900)),
        )
        .addSubcommand((sub) =>
            sub.setName('szablon-usun').setDescription('Delete a ready-made answer')
                .addStringOption((option) => option.setName('name').setDescription('Snippet name').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('szablon').setDescription('Send a ready-made answer in this conversation')
                .addStringOption((option) => option.setName('name').setDescription('Snippet name').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((sub) => sub.setName('szablony').setDescription('List ready-made answers')),
    slashOnly: true,

    async autocomplete(interaction) {
        const config = await getModmailConfig(interaction.guildId);
        const typed = interaction.options.getFocused().toLowerCase();
        await interaction.respond(
            Object.keys(config.snippets).filter((name) => name.includes(typed)).slice(0, 25).map((name) => ({ name, value: name })),
        );
    },

    async execute(interaction, guildConfig, client) {
        const guild = requireGuild(interaction);
        const subcommand = interaction.options.getSubcommand();
        const config = await getModmailConfig(guild.id);

        if (ADMIN_SUBCOMMANDS.has(subcommand)) {
            requirePermission(interaction, PermissionFlagsBits.ManageGuild);
        } else if (!isModmailStaff(interaction.member, config)) {
            throw userError(t('Only modmail staff can use this.'), ErrorTypes.PERMISSION);
        }

        if (subcommand === 'kontakt') {
            const user = interaction.options.getUser('user');
            if (user.bot) throw userError(t('Bots cannot use modmail.'));
            await InteractionHelper.safeDefer(interaction);
            const thread = await openThread(client, guild, user, { openedBy: interaction.user });
            return respond(interaction, successEmbed(t`Conversation with ${user} opened: <#${thread.channelId}>`));
        }

        if (subcommand === 'odpowiedz' || subcommand === 'szablon') {
            const thread = await requireThread(interaction);
            let message;
            if (subcommand === 'szablon') {
                const name = interaction.options.getString('name').toLowerCase().trim();
                message = config.snippets[name];
                if (!message) throw userError(t`There is no snippet called \`${name}\`.`);
            } else {
                message = interaction.options.getString('message');
            }
            const anonymous = interaction.options.getBoolean('anonymous') ?? config.anonymous;
            const delivered = await relayToUser(client, thread, interaction.member, message, null, { anonymous });
            if (!delivered) throw userError(t('Not delivered — the user has DMs closed or left every shared server.'));
            return respond(interaction, createEmbed({
                author: { name: interaction.member.displayName, iconURL: interaction.member.displayAvatarURL() },
                description: truncate(message, 3900),
                color: 'success',
                footer: anonymous ? t('Sent anonymously') : t('Sent'),
            }));
        }

        if (subcommand === 'zamknij') {
            await requireThread(interaction);
            await respond(interaction, successEmbed(t('Closing the conversation…')));
            await closeThread(client, guild, interaction.channelId, interaction.member, interaction.options.getString('reason'));
            return undefined;
        }

        if (subcommand === 'zablokuj' || subcommand === 'odblokuj') {
            const user = interaction.options.getUser('user');
            const block = subcommand === 'zablokuj';
            await updateModmailConfig(guild.id, (data) => {
                data.blocked = data.blocked.filter((id) => id !== user.id);
                if (block) data.blocked.push(user.id);
            });
            return respond(interaction, successEmbed(
                block ? t`${user} can no longer use modmail.` : t`${user} can use modmail again.`,
            ), { ephemeral: true });
        }

        if (subcommand === 'szablon-dodaj') {
            const name = await setSnippet(guild.id, interaction.options.getString('name'), interaction.options.getString('text'));
            return respond(interaction, successEmbed(t`Snippet \`${name}\` saved. Send it with \`/modmail szablon\`.`), { ephemeral: true });
        }

        if (subcommand === 'szablon-usun') {
            const name = interaction.options.getString('name');
            if (!await removeSnippet(guild.id, name)) throw userError(t`There is no snippet called \`${name}\`.`);
            return respond(interaction, successEmbed(t`Snippet \`${name}\` deleted.`), { ephemeral: true });
        }

        if (subcommand === 'snippets') {
            const entries = Object.entries(config.snippets);
            if (entries.length === 0) {
                return respond(interaction, infoEmbed(t('No snippets yet. Add one with `/modmail szablon-dodaj`.')), { ephemeral: true });
            }
            return respond(interaction, createEmbed({
                title: t('📋 Modmail snippets'),
                description: entries.map(([name, text]) => `**\`${name}\`** — ${truncate(text.replace(/\n/g, ' '), 120)}`).join('\n'),
                footer: false,
            }), { ephemeral: true });
        }

        throw userError(t('This subcommand is not recognised.'));
    },
};
