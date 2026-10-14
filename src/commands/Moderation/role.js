import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { fmtNumber, t } from '../../i18n/index.js';
import { respond, requireBotPermission, requireGuild, userError } from '../../utils/featureKit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const WHO_CHOICES = [
    { name: 'Everyone', value: 'all' },
    { name: 'Humans only', value: 'humans' },
    { name: 'Bots only', value: 'bots' },
];

function assertRoleUsable(interaction, role) {
    const guild = interaction.guild;
    if (role.id === guild.id || role.managed) throw userError(t('That role cannot be given or taken by hand.'));
    if (!role.editable) throw userError(t`I cannot manage ${role} — move my role above it in **Server Settings → Roles**.`);
    const member = interaction.member;
    if (guild.ownerId !== member.id && member.roles.highest.comparePositionTo(role) <= 0) {
        throw userError(t`${role} is not below your highest role, so you cannot manage it.`);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Give or take roles — for one member or for everyone')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand((sub) =>
            sub.setName('dodaj').setDescription('Give a role to a member')
                .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
                .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('usun').setDescription('Take a role from a member')
                .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
                .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('wszyscy').setDescription('Give a role to everyone on the server')
                .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true))
                .addStringOption((option) => option.setName('who').setDescription('Who gets it (default: humans)').addChoices(...WHO_CHOICES)),
        )
        .addSubcommand((sub) =>
            sub.setName('clear').setDescription('Take a role from everyone who has it')
                .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('info').setDescription('Show details of a role')
                .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)),
        ),
    slashOnly: true,
    abuseProtection: { enabled: true, maxAttempts: 4, windowMs: 30_000 },

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const subcommand = interaction.options.getSubcommand();
        const role = interaction.options.getRole('role');

        if (subcommand === 'info') {
            return respond(interaction, createEmbed({
                title: `🎭 ${role.name}`,
                description: [
                    t`**Members:** ${fmtNumber(role.members.size)}`,
                    t`**Color:** \`${role.hexColor}\``,
                    t`**Position:** ${role.position}`,
                    t`**Mentionable:** ${role.mentionable ? t('Yes') : t('No')}`,
                    t`**Shown separately:** ${role.hoist ? t('Yes') : t('No')}`,
                    t`**Created:** <t:${Math.floor(role.createdTimestamp / 1000)}:D>`,
                ].join('\n'),
                color: role.color || 'primary',
                footer: `ID: ${role.id}`,
            }));
        }

        requireBotPermission(guild, PermissionFlagsBits.ManageRoles);
        assertRoleUsable(interaction, role);

        if (subcommand === 'dodaj' || subcommand === 'usun') {
            const user = interaction.options.getUser('member');
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (!member) throw userError(t('The target user is not currently in this server.'));
            const has = member.roles.cache.has(role.id);
            if (subcommand === 'dodaj') {
                if (has) throw userError(t`${member} already has ${role}.`);
                await member.roles.add(role, `Role given by ${interaction.user.tag}`);
                return respond(interaction, successEmbed(t`Gave ${role} to ${member}.`));
            }
            if (!has) throw userError(t`${member} does not have ${role}.`);
            await member.roles.remove(role, `Role taken by ${interaction.user.tag}`);
            return respond(interaction, successEmbed(t`Took ${role} from ${member}.`));
        }

        // Mass changes: fetch everyone, then work through the list at a pace Discord accepts.
        await InteractionHelper.safeDefer(interaction);
        const members = await guild.members.fetch();
        const who = interaction.options.getString('who') ?? 'humans';
        const targets = [...members.values()].filter((member) => {
            if (subcommand === 'clear') return member.roles.cache.has(role.id);
            if (member.roles.cache.has(role.id)) return false;
            if (who === 'humans') return !member.user.bot;
            if (who === 'bots') return member.user.bot;
            return true;
        });

        if (targets.length === 0) {
            throw userError(subcommand === 'clear' ? t`Nobody has ${role}.` : t`Everyone already has ${role}.`);
        }

        await respond(interaction, createEmbed({
            description: t`⏳ Working on **${fmtNumber(targets.length)}** {0|member|members}… this can take a while.`,
            color: 'info',
            footer: false,
        }));

        let done = 0;
        let failed = 0;
        const reason = `Mass role change by ${interaction.user.tag}`;
        for (const member of targets) {
            const ok = await (subcommand === 'clear' ? member.roles.remove(role, reason) : member.roles.add(role, reason))
                .then(() => true)
                .catch(() => false);
            if (ok) done += 1; else failed += 1;
        }

        return InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(
                subcommand === 'clear' ? t`Took ${role} from **${fmtNumber(done)}** {1|member|members}.` : t`Gave ${role} to **${fmtNumber(done)}** {1|member|members}.`,
                failed > 0 ? t`Could not change ${failed} {0|member|members} (role hierarchy).` : '',
            )],
        });
    },
};
