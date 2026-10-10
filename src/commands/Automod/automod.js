import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { respond, requireGuild, userError, truncate } from '../../utils/featureKit.js';
import {
    ACTIONS,
    RULES,
    actionLabel,
    getAutomodConfig,
    ruleLabel,
    updateAutomodConfig,
} from '../../services/automodService.js';
import { t } from '../../i18n/index.js';

const RULE_CHOICES = [
    { name: 'Invite links', value: 'invites' },
    { name: 'Links', value: 'links' },
    { name: 'Banned words', value: 'words' },
    { name: 'Message spam', value: 'spam' },
    { name: 'Mass mentions', value: 'mentions' },
    { name: 'Too many capital letters', value: 'caps' },
    { name: 'Repeated messages', value: 'duplicates' },
    { name: 'Emoji flood', value: 'emojis' },
];

const ACTION_CHOICES = [
    { name: 'Delete the message', value: 'delete' },
    { name: 'Delete and add a warning', value: 'warn' },
    { name: 'Delete and time out', value: 'timeout' },
];

function ruleLimitText(rule, settings) {
    if (rule === 'spam') return t`${settings.limit} messages in ${settings.seconds}s`;
    if (rule === 'mentions') return t`${settings.limit}+ mentions`;
    if (rule === 'caps') return t`${settings.percent}% capitals`;
    if (rule === 'duplicates') return t`${settings.limit}× the same text`;
    if (rule === 'emojis') return t`${settings.limit}+ emoji`;
    if (rule === 'words') return t`${settings.list.length} words`;
    if (rule === 'links') return t`${settings.allow.length} allowed domains`;
    return null;
}

function statusEmbed(config) {
    const rules = RULES.map((rule) => {
        const settings = config.rules[rule];
        const extra = ruleLimitText(rule, settings);
        return `${settings.enabled ? '🟢' : '⚫'} **${ruleLabel(rule)}** — ${actionLabel(settings.action)}${extra ? ` · ${extra}` : ''}`;
    });
    const raid = config.raid;

    return createEmbed({
        title: t('🛡️ Automod'),
        description: [
            config.enabled ? t('**Automod is on.**') : t('**Automod is off.** Turn it on with `/automod toggle`.'),
            '',
            ...rules,
            '',
            `${raid.enabled ? '🟢' : '⚫'} **${t('Anti-raid')}** — ${t`${raid.joins} joins in ${raid.seconds}s`} · ${raid.action === 'kick' ? t('kick new members') : t('alert only')}`,
            `${raid.minAccountAgeDays > 0 ? '🟢' : '⚫'} **${t('Minimum account age')}** — ${raid.minAccountAgeDays > 0 ? t`${raid.minAccountAgeDays} days` : t('off')}`,
        ].join('\n'),
        fields: [
            { name: t('Log channel'), value: config.logChannelId ? `<#${config.logChannelId}>` : t('not set'), inline: true },
            { name: t('Timeout length'), value: t`${config.timeoutMinutes} min`, inline: true },
            { name: t('Repeat offenders'), value: t`${config.strikes.limit} violations in ${config.strikes.windowMinutes} min ➜ ${config.strikes.timeoutMinutes} min timeout`, inline: false },
            {
                name: t('Ignored'),
                value: [
                    ...config.exemptRoles.map((id) => `<@&${id}>`),
                    ...config.exemptChannels.map((id) => `<#${id}>`),
                ].join(' ') || t('Members with Manage Messages are always ignored.'),
                inline: false,
            },
        ],
        color: config.enabled ? 'success' : 'secondary',
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Automatic moderation: links, spam, banned words, raids')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) => sub.setName('status').setDescription('Show automod settings'))
        .addSubcommand((sub) =>
            sub.setName('toggle').setDescription('Turn automod on or off')
                .addBooleanOption((option) => option.setName('enabled').setDescription('On or off').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub.setName('rule').setDescription('Configure one rule')
                .addStringOption((option) => option.setName('rule').setDescription('Which rule').setRequired(true).addChoices(...RULE_CHOICES))
                .addBooleanOption((option) => option.setName('enabled').setDescription('Turn the rule on or off'))
                .addStringOption((option) => option.setName('action').setDescription('What happens to the message').addChoices(...ACTION_CHOICES))
                .addIntegerOption((option) => option.setName('limit').setDescription('Threshold (messages, mentions, emoji, % of capitals)').setMinValue(2).setMaxValue(100))
                .addIntegerOption((option) => option.setName('seconds').setDescription('Spam rule: time window in seconds').setMinValue(2).setMaxValue(60)),
        )
        .addSubcommand((sub) =>
            sub.setName('words').setDescription('Add or remove banned words')
                .addStringOption((option) => option.setName('add').setDescription('Words to add, separated by commas (* = any letters)').setMaxLength(1000))
                .addStringOption((option) => option.setName('remove').setDescription('Words to remove, separated by commas').setMaxLength(1000)),
        )
        .addSubcommand((sub) =>
            sub.setName('links').setDescription('Domains that are always allowed')
                .addStringOption((option) => option.setName('allow').setDescription('Domains to allow, e.g. youtube.com, pikczu.pl').setMaxLength(500))
                .addStringOption((option) => option.setName('disallow').setDescription('Domains to remove from the allowed list').setMaxLength(500)),
        )
        .addSubcommand((sub) =>
            sub.setName('ignore').setDescription('Roles and channels automod leaves alone (repeat to undo)')
                .addRoleOption((option) => option.setName('role').setDescription('Role to ignore'))
                .addChannelOption((option) =>
                    option.setName('channel').setDescription('Channel or category to ignore').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory, ChannelType.GuildForum),
                ),
        )
        .addSubcommand((sub) =>
            sub.setName('settings').setDescription('Log channel and timeout lengths')
                .addChannelOption((option) => option.setName('log_channel').setDescription('Where automod reports go').addChannelTypes(ChannelType.GuildText))
                .addIntegerOption((option) => option.setName('timeout_minutes').setDescription('Timeout for rules set to "time out"').setMinValue(1).setMaxValue(40320))
                .addIntegerOption((option) => option.setName('strike_limit').setDescription('Violations before the long timeout').setMinValue(2).setMaxValue(20))
                .addIntegerOption((option) => option.setName('strike_timeout').setDescription('Long timeout in minutes for repeat offenders').setMinValue(1).setMaxValue(40320)),
        )
        .addSubcommand((sub) =>
            sub.setName('raid').setDescription('Anti-raid and minimum account age')
                .addBooleanOption((option) => option.setName('enabled').setDescription('Detect join floods'))
                .addIntegerOption((option) => option.setName('joins').setDescription('How many joins count as a raid').setMinValue(3).setMaxValue(100))
                .addIntegerOption((option) => option.setName('seconds').setDescription('...within how many seconds').setMinValue(3).setMaxValue(120))
                .addStringOption((option) =>
                    option.setName('action').setDescription('What to do during a raid').addChoices(
                        { name: 'Alert staff only', value: 'alert' },
                        { name: 'Kick members who join during the raid', value: 'kick' },
                    ),
                )
                .addIntegerOption((option) => option.setName('min_account_age').setDescription('Kick accounts younger than this many days (0 = off)').setMinValue(0).setMaxValue(365)),
        ),
    slashOnly: true,

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'status') {
            return respond(interaction, statusEmbed(await getAutomodConfig(guild.id, { fresh: true })), { ephemeral: true });
        }

        if (subcommand === 'toggle') {
            const enabled = interaction.options.getBoolean('enabled');
            const config = await updateAutomodConfig(guild.id, (data) => { data.enabled = enabled; });
            const activeRules = RULES.filter((rule) => config.rules[rule].enabled).length;
            return respond(interaction, successEmbed(
                enabled ? t('Automod is on') : t('Automod is off'),
                enabled && activeRules === 0 ? t('No rule is active yet. Turn rules on with `/automod rule`.') : '',
            ));
        }

        if (subcommand === 'rule') {
            const rule = interaction.options.getString('rule');
            const enabled = interaction.options.getBoolean('enabled');
            const action = interaction.options.getString('action');
            const limit = interaction.options.getInteger('limit');
            const seconds = interaction.options.getInteger('seconds');
            if (action && !ACTIONS.includes(action)) throw userError(t('Unknown action.'));

            const config = await updateAutomodConfig(guild.id, (data) => {
                const settings = data.rules[rule];
                if (enabled !== null) settings.enabled = enabled;
                if (action) settings.action = action;
                if (limit !== null) {
                    if (rule === 'caps') settings.percent = Math.min(100, Math.max(30, limit));
                    else if ('limit' in settings) settings.limit = limit;
                }
                if (seconds !== null && rule === 'spam') settings.seconds = seconds;
            });
            const settings = config.rules[rule];
            const extra = ruleLimitText(rule, settings);
            return respond(interaction, successEmbed(
                t`${ruleLabel(rule)}: ${settings.enabled ? t('on') : t('off')}`,
                [
                    t`**Action:** ${actionLabel(settings.action)}`,
                    extra ? t`**Threshold:** ${extra}` : null,
                    config.enabled ? null : t('⚠️ Automod itself is off — turn it on with `/automod toggle`.'),
                    rule === 'words' && settings.list.length === 0 ? t('Add words with `/automod words`.') : null,
                ].filter(Boolean).join('\n'),
            ));
        }

        if (subcommand === 'words') {
            const split = (text) => (text ?? '').split(',').map((word) => word.trim().toLowerCase()).filter((word) => word.length >= 2 && word.length <= 40);
            const add = split(interaction.options.getString('add'));
            const remove = split(interaction.options.getString('remove'));
            const config = await updateAutomodConfig(guild.id, (data) => {
                const list = new Set(data.rules.words.list);
                add.forEach((word) => list.add(word));
                remove.forEach((word) => list.delete(word));
                if (list.size > 300) throw userError(t('The list can hold up to 300 words.'));
                data.rules.words.list = [...list].sort();
            });
            const list = config.rules.words.list;
            return respond(interaction, createEmbed({
                title: t`🚫 Banned words (${list.length})`,
                description: list.length > 0 ? `||${truncate(list.join(', '), 3900)}||` : t('The list is empty.'),
                footer: config.rules.words.enabled ? false : t('The rule is off. Turn it on with /automod rule.'),
            }), { ephemeral: true });
        }

        if (subcommand === 'links') {
            const split = (text) => (text ?? '').split(/[,\s]+/).map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain));
            const allow = split(interaction.options.getString('allow'));
            const disallow = split(interaction.options.getString('disallow'));
            const config = await updateAutomodConfig(guild.id, (data) => {
                const list = new Set(data.rules.links.allow);
                allow.forEach((domain) => list.add(domain));
                disallow.forEach((domain) => list.delete(domain));
                if (list.size > 100) throw userError(t('The list can hold up to 100 domains.'));
                data.rules.links.allow = [...list].sort();
            });
            const list = config.rules.links.allow;
            return respond(interaction, createEmbed({
                title: t`🔗 Allowed domains (${list.length})`,
                description: list.length > 0 ? list.map((domain) => `\`${domain}\``).join(' ') : t('No domain is allowed — every link is removed while the rule is on.'),
                footer: config.rules.links.enabled ? false : t('The rule is off. Turn it on with /automod rule.'),
            }), { ephemeral: true });
        }

        if (subcommand === 'ignore') {
            const role = interaction.options.getRole('role');
            const channel = interaction.options.getChannel('channel');
            if (!role && !channel) throw userError(t('Pick a role or a channel.'));
            const toggle = (list, id) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
            const config = await updateAutomodConfig(guild.id, (data) => {
                if (role) data.exemptRoles = toggle(data.exemptRoles, role.id);
                if (channel) data.exemptChannels = toggle(data.exemptChannels, channel.id);
            });
            return respond(interaction, statusEmbed(config), { ephemeral: true });
        }

        if (subcommand === 'settings') {
            const logChannel = interaction.options.getChannel('log_channel');
            const config = await updateAutomodConfig(guild.id, (data) => {
                if (logChannel) data.logChannelId = logChannel.id;
                const timeoutMinutes = interaction.options.getInteger('timeout_minutes');
                if (timeoutMinutes !== null) data.timeoutMinutes = timeoutMinutes;
                const strikeLimit = interaction.options.getInteger('strike_limit');
                if (strikeLimit !== null) data.strikes.limit = strikeLimit;
                const strikeTimeout = interaction.options.getInteger('strike_timeout');
                if (strikeTimeout !== null) data.strikes.timeoutMinutes = strikeTimeout;
            });
            return respond(interaction, statusEmbed(config), { ephemeral: true });
        }

        if (subcommand === 'raid') {
            const config = await updateAutomodConfig(guild.id, (data) => {
                const enabled = interaction.options.getBoolean('enabled');
                if (enabled !== null) data.raid.enabled = enabled;
                const joins = interaction.options.getInteger('joins');
                if (joins !== null) data.raid.joins = joins;
                const seconds = interaction.options.getInteger('seconds');
                if (seconds !== null) data.raid.seconds = seconds;
                const action = interaction.options.getString('action');
                if (action) data.raid.action = action;
                const minAge = interaction.options.getInteger('min_account_age');
                if (minAge !== null) data.raid.minAccountAgeDays = minAge;
            });
            if (!config.enabled) {
                return respond(interaction, infoEmbed(t('Saved'), t('Automod itself is off — turn it on with `/automod toggle`.')), { ephemeral: true });
            }
            return respond(interaction, statusEmbed(config), { ephemeral: true });
        }

        throw userError(t('This subcommand is not recognised.'));
    },
};
