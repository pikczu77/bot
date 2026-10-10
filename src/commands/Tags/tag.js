import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { respond, requireGuild, requirePermission, userError, truncate } from '../../utils/featureKit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    addResponder,
    countTagUse,
    deleteTag,
    getTagData,
    removeResponder,
    renderTagText,
    saveTag,
} from '../../services/tagService.js';
import { getCommandPrefix } from '../../config/bot.js';
import { t } from '../../i18n/index.js';

const ADMIN_SUBCOMMANDS = new Set(['set', 'delete', 'reply-add', 'reply-remove']);

export default {
    data: new SlashCommandBuilder()
        .setName('tag')
        .setDescription('Your own text commands and automatic replies')
        .addSubcommand((sub) =>
            sub.setName('show').setDescription('Send a tag')
                .addStringOption((option) => option.setName('name').setDescription('Tag name').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List tags and automatic replies'))
        .addSubcommand((sub) =>
            sub.setName('set').setDescription('Create or change a tag (admin)')
                .addStringOption((option) => option.setName('name').setDescription('Name, used as !name').setRequired(true).setMaxLength(32))
                .addStringOption((option) => option.setName('text').setDescription('Text. Placeholders: {user} {server} {channel} {members}').setRequired(true).setMaxLength(1900)),
        )
        .addSubcommand((sub) =>
            sub.setName('delete').setDescription('Delete a tag (admin)')
                .addStringOption((option) => option.setName('name').setDescription('Tag name').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('reply-add').setDescription('Answer automatically when a message matches (admin)')
                .addStringOption((option) => option.setName('trigger').setDescription('Text to look for').setRequired(true).setMaxLength(100))
                .addStringOption((option) => option.setName('response').setDescription('What the bot answers').setRequired(true).setMaxLength(1900))
                .addStringOption((option) =>
                    option.setName('match').setDescription('How to match (default: whole word)').addChoices(
                        { name: 'Whole word', value: 'word' },
                        { name: 'Anywhere in the message', value: 'contains' },
                        { name: 'Message starts with', value: 'starts' },
                        { name: 'Exact message', value: 'exact' },
                    ),
                ),
        )
        .addSubcommand((sub) =>
            sub.setName('reply-remove').setDescription('Remove an automatic reply (admin)')
                .addStringOption((option) => option.setName('trigger').setDescription('Trigger text').setRequired(true).setAutocomplete(true)),
        ),
    slashOnly: true,

    async autocomplete(interaction) {
        const data = await getTagData(interaction.guildId);
        const focused = interaction.options.getFocused(true);
        const typed = String(focused.value).toLowerCase();
        const source = focused.name === 'trigger' ? data.responders.map((entry) => entry.trigger) : Object.keys(data.tags);
        await interaction.respond(
            source.filter((name) => name.includes(typed)).slice(0, 25).map((name) => ({ name: truncate(name, 100), value: name })),
        );
    },

    async execute(interaction, guildConfig) {
        const guild = requireGuild(interaction);
        const subcommand = interaction.options.getSubcommand();
        if (ADMIN_SUBCOMMANDS.has(subcommand)) requirePermission(interaction, PermissionFlagsBits.ManageGuild);
        const prefix = guildConfig?.prefix || getCommandPrefix();

        if (subcommand === 'show') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const data = await getTagData(guild.id);
            const tag = data.tags[name];
            if (!tag) throw userError(t`There is no tag called \`${name}\`. See \`/tag list\`.`);
            countTagUse(guild.id, name).catch(() => {});
            return InteractionHelper.universalReply(interaction, {
                content: renderTagText(tag.text, interaction),
                allowedMentions: { parse: [], users: [interaction.user.id] },
            });
        }

        if (subcommand === 'list') {
            const data = await getTagData(guild.id, { fresh: true });
            const tags = Object.entries(data.tags).sort((a, b) => (b[1].uses ?? 0) - (a[1].uses ?? 0));
            if (tags.length === 0 && data.responders.length === 0) {
                return respond(interaction, infoEmbed(t('No tags yet. An admin can add one with `/tag set`.')), { ephemeral: true });
            }
            const fields = [];
            if (tags.length > 0) {
                fields.push({ name: t`Tags (${tags.length})`, value: truncate(tags.map(([name]) => `\`${prefix}${name}\``).join(' '), 1024) });
            }
            if (data.responders.length > 0) {
                fields.push({
                    name: t`Automatic replies (${data.responders.length})`,
                    value: truncate(data.responders.map((entry) => `\`${truncate(entry.trigger, 30)}\` ➜ ${truncate(entry.response.replace(/\n/g, ' '), 50)}`).join('\n'), 1024),
                });
            }
            return respond(interaction, createEmbed({
                title: t('🏷️ Tags'),
                description: t`Send a tag with \`${prefix}name\` or \`/tag show\`.`,
                fields,
                footer: false,
            }), { ephemeral: true });
        }

        if (subcommand === 'set') {
            const name = await saveTag(guild.id, interaction.options.getString('name'), interaction.options.getString('text'), interaction.user.id);
            return respond(interaction, successEmbed(t`Tag saved`, t`Use it with \`${prefix}${name}\` or \`/tag show\`.`));
        }

        if (subcommand === 'delete') {
            const name = interaction.options.getString('name');
            if (!await deleteTag(guild.id, name)) throw userError(t`There is no tag called \`${name}\`.`);
            return respond(interaction, successEmbed(t`Tag \`${name}\` deleted.`));
        }

        if (subcommand === 'reply-add') {
            const trigger = interaction.options.getString('trigger').trim();
            if (trigger.length < 2) throw userError(t('The trigger must be at least 2 characters long.'));
            await addResponder(guild.id, {
                trigger,
                response: interaction.options.getString('response'),
                mode: interaction.options.getString('match') ?? 'word',
                createdBy: interaction.user.id,
            });
            return respond(interaction, successEmbed(t`I will answer when someone writes \`${truncate(trigger, 60)}\`.`));
        }

        if (subcommand === 'reply-remove') {
            const trigger = interaction.options.getString('trigger');
            if (!await removeResponder(guild.id, trigger)) throw userError(t('There is no automatic reply with that trigger.'));
            return respond(interaction, successEmbed(t('Automatic reply removed.')));
        }

        throw userError(t('This subcommand is not recognised.'));
    },
};
