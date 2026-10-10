import { botConfig, getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { getGuildConfig, setGuildConfig } from '../../../services/config/guildConfig.js';
import { getWelcomeConfig } from '../../../utils/database.js';
import { validateAutoVerifyCriteria } from '../../../services/verificationService.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';
import { t } from '../../../i18n/index.js';

const autoVerifyDefaults = botConfig.verification?.autoVerify || {};
const minAccountAgeDays = autoVerifyDefaults.minAccountAge ?? 1;
const maxAccountAgeDays = autoVerifyDefaults.maxAccountAge ?? 365;
const defaultAccountAgeDays = autoVerifyDefaults.defaultAccountAgeDays ?? 7;

function buildDashboardEmbed(cfg, guild, conflictSummary = '') {
    const autoVerify = cfg.verification?.autoVerify;
    const autoVerifyRole = autoVerify?.roleId ? guild.roles.cache.get(autoVerify.roleId) : null;
    
    let criteriaDescription = t("`Not configured`");
    if (autoVerify?.criteria) {
        switch (autoVerify.criteria) {
            case "account_age":
                criteriaDescription = t`\`Account Age\` - \`${autoVerify.accountAgeDays} days\``;
                break;
            case "none":
                criteriaDescription = t`\`No Criteria\``;
                break;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(t('🤖 Auto-Verification Dashboard'))
        .setDescription(t`Manage auto-verification settings for **${guild.name}**.\nSelect an option below to modify a setting.`)
        .setColor(getColor('info'))
        .addFields(
            { name: t('System Status'), value: autoVerify?.enabled ? t('Enabled') : t('Disabled'), inline: true },
            { name: t('Target Role'), value: autoVerifyRole ? autoVerifyRole.toString() : t('`Not set`'), inline: true },
            { name: t('Criteria'), value: criteriaDescription, inline: true },
            { name: t('Account Age'), value: autoVerify?.accountAgeDays ? t`\`${autoVerify.accountAgeDays}\` days` : '`N/A`', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
        );

    if (conflictSummary) {
        embed.addFields({ name: t('Setup Conflicts'), value: conflictSummary, inline: false });
    }

    return embed
        .setFooter({ text: t('Dashboard closes after 10 minutes of inactivity') })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`autoverify_cfg_${guildId}`)
        .setPlaceholder(t('Select a setting to configure...'))
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(t('Change Role'))
                .setDescription(t('Select the role to assign automatically'))
                .setValue('role')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel(t('Edit Account Age Days'))
                .setDescription(t('Set minimum account age in days'))
                .setValue('account_age')
                .setEmoji('📅'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const autoVerifyOn = cfg.verification?.autoVerify?.enabled === true;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_criteria_${guildId}`)
            .setLabel(t('Change Criteria'))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_toggle_${guildId}`)
            .setLabel('Auto-Verification')
            .setStyle(autoVerifyOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('🤖')
            .setDisabled(disabled),
    );
}

async function refreshDashboard(rootInteraction, cfg, guildId, client) {
    try {
        const selectMenu = buildSelectMenu(guildId);

        let conflictSummary = '';
        try {
            const welcomeConfig = await getWelcomeConfig(client, guildId);
            const verificationEnabled = Boolean(cfg.verification?.enabled);
            const autoRoleConfigured = Boolean(cfg.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
            
            const conflicts = [
                verificationEnabled ? t('Verification system is enabled') : null,
                autoRoleConfigured ? t('AutoRole is configured') : null
            ].filter(Boolean);
            
            if (conflicts.length > 0) {
                conflictSummary = conflicts.join('\n');
            }
        } catch (error) {
            logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
        }
        
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild, conflictSummary)],
            components: [
                buildButtonRow(cfg, guildId),
                new ActionRowBuilder().addComponents(selectMenu),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh autoverify dashboard (interaction may have expired):', error.message);
    }
}

export default {
    prefixOnly: false,
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);

            if (!guildConfig.verification?.autoVerify?.enabled) {
                
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const blockingMessage = [];
                if (verificationEnabled) blockingMessage.push(t('Verification system is enabled'));
                if (autoRoleConfigured) blockingMessage.push(t('AutoRole is configured'));

                const blockingText = blockingMessage.length > 0 
                    ? t`\n\n⚠️ **To enable AutoVerify, you must first disable:**\n${blockingMessage.map(msg =>`• ${msg}`).join('\n')}`
                    : '';

                return await InteractionHelper.safeReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(t('🤖 Auto-Verification Dashboard'))
                            .setDescription(t`Auto-verification is not yet configured.${blockingText}\n\nUse \`/autoverify setup\` to configure it.`)
                            .setColor(getColor('warning'))
                            .setFooter({ text: t('Dashboard closes after 10 minutes of inactivity') })
                            .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            await InteractionHelper.safeDefer(interaction, { ephemeral: true });

            const selectMenu = buildSelectMenu(guildId);

            let conflictSummary = '';
            try {
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const conflicts = [
                    verificationEnabled ? t('Verification system is enabled') : null,
                    autoRoleConfigured ? t('AutoRole is configured') : null
                ].filter(Boolean);
                
                if (conflicts.length > 0) {
                    conflictSummary = conflicts.join('\n');
                }
            } catch (error) {
                logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(guildConfig, interaction.guild, conflictSummary)],
                components: [
                    buildButtonRow(guildConfig, guildId),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `autoverify_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'role':
                            await handleRole(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'account_age':
                            await handleAccountAge(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Autoverify config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected autoverify dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || t('An error occurred while processing your selection.')
                            : t('An unexpected error occurred while updating the configuration.');

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await replyUserError(selectInteraction, {
                        type: ErrorTypes.CONFIGURATION,
                        message: errorMessage,
                    }).catch(() => {});
                }
            });

            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id && 
                    (i.customId === `autoverify_cfg_toggle_${guildId}` || i.customId === `autoverify_cfg_criteria_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    if (btnInteraction.customId === `autoverify_cfg_criteria_${guildId}`) {
                        await handleCriteria(btnInteraction, interaction, guildConfig, guildId, client);
                    } else if (btnInteraction.customId === `autoverify_cfg_toggle_${guildId}`) {
                        await btnInteraction.deferUpdate().catch(() => null);
                        guildConfig.verification.autoVerify.enabled = !guildConfig.verification.autoVerify.enabled;
                        await setGuildConfig(client, guildId, guildConfig);
                        
                        await btnInteraction.followUp({
                            embeds: [
                                successEmbed(
                                    t('✅ Status Updated'),
                                    t`Auto-verification is now **${guildConfig.verification.autoVerify.enabled ? t('enabled') : t('disabled')}**.`,
                                ),
                            ],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, guildConfig, guildId, client);
                    }
                } catch (err) {
                    logger.debug('Button interaction error:', err.message);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    try {
                        const timeoutEmbed = new EmbedBuilder()
                            .setTitle(t('Dashboard Timed Out'))
                            .setDescription(t('This dashboard has been closed due to inactivity. Please run the command again to continue.'))
                            .setColor(getColor('error'));
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [timeoutEmbed],
                            components: [],
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (error) {
                        logger.debug('Could not update dashboard on timeout:', error.message);
                    }
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in autoverify_dashboard:', error);
            throw new TitanBotError(
                `Auto-verification dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                t('Failed to open the auto-verification dashboard.'),
            );
        }
    },
};

async function handleCriteria(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    
    if (!selectInteraction.deferred) {
        await selectInteraction.deferUpdate().catch(() => null);
    }
    
    const criteriaEmbed = new EmbedBuilder()
        .setTitle(t('Select Verification Criteria'))
        .setDescription(t('Choose the criteria for automatic verification'))
        .setColor(getColor('info'));

    const criteriaMenu = new StringSelectMenuBuilder()
        .setCustomId('autoverify_criteria_select')
        .setPlaceholder(t('Select criteria...'))
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(t`Account Age (older than ${defaultAccountAgeDays} days)`)
                .setDescription(t('Users with older accounts will be auto-verified'))
                .setValue('account_age'),
            new StringSelectMenuOptionBuilder()
                .setLabel(t('No Criteria (verify everyone)'))
                .setDescription(t('All users gain the role immediately'))
                .setValue('none'),
        );

    await selectInteraction.followUp({
        embeds: [criteriaEmbed],
        components: [new ActionRowBuilder().addComponents(criteriaMenu)],
        flags: MessageFlags.Ephemeral,
    });

    const criteriaCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_criteria_select',
        time: 60_000,
        max: 1,
    });

    criteriaCollector.on('collect', async criteriaInteraction => {
        await criteriaInteraction.deferUpdate();
        const newCriteria = criteriaInteraction.values[0];

        guildConfig.verification.autoVerify.criteria = newCriteria;

        if (newCriteria !== 'account_age') {
            guildConfig.verification.autoVerify.accountAgeDays = null;
        } else if (!guildConfig.verification.autoVerify.accountAgeDays) {
            guildConfig.verification.autoVerify.accountAgeDays = defaultAccountAgeDays;
        }

        await setGuildConfig(client, guildId, guildConfig);

        let criteriaDisplay = '';
        switch (newCriteria) {
            case 'account_age':
                criteriaDisplay = t`Account Age (${guildConfig.verification.autoVerify.accountAgeDays} days)`;
                break;
            case 'none':
                criteriaDisplay = t('No Criteria');
                break;
        }

        await criteriaInteraction.followUp({
            embeds: [successEmbed(t('Criteria Updated'), t`Auto-verification criteria changed to **${criteriaDisplay}**.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    criteriaCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                message: t('No criteria selected. The setting was not changed.'),
            }).catch(() => {});
        }
    });
}

async function handleRole(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('autoverify_role_select')
        .setPlaceholder(t('Select a role...'))
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(t('Auto-Verification Role'))
                .setDescription(t('Select the role to assign to auto-verified users.'))
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_role_select',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (role.id === rootInteraction.guild.id || role.managed) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                message: t('Please choose a normal assignable role (not @everyone or a bot-managed role).'),
            });
            return;
        }

        const botMember = rootInteraction.guild.members.me;
        if (role.position >= botMember.roles.highest.position) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.PERMISSION,
                message: t('The selected role must be below my highest role in the server role hierarchy.'),
            });
            return;
        }

        guildConfig.verification.autoVerify.roleId = role.id;
        await setGuildConfig(client, guildId, guildConfig);

        await roleInteraction.followUp({
            embeds: [successEmbed(t('Role Updated'), t`Auto-verification role set to ${role}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                message: t('No role was selected. The setting was not changed.'),
            }).catch(() => {});
        }
    });
}

async function handleAccountAge(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('autoverify_account_age_modal')
        .setTitle(t('Set Account Age Requirement'))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('age_input')
                    .setLabel(t('Minimum Account Age (days)'))
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(t`Between ${minAccountAgeDays} and ${maxAccountAgeDays}`)
                    .setValue((guildConfig.verification.autoVerify.accountAgeDays || defaultAccountAgeDays).toString())
                    .setRequired(true),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'autoverify_account_age_modal' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const inputValue = submitted.fields.getTextInputValue('age_input').trim();
    const days = parseInt(inputValue, 10);

    if (isNaN(days) || days < minAccountAgeDays || days > maxAccountAgeDays) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: t`Please enter a number between ${minAccountAgeDays} and ${maxAccountAgeDays}.` });
        return;
    }

    guildConfig.verification.autoVerify.accountAgeDays = days;
    await setGuildConfig(client, guildId, guildConfig);

    await submitted.reply({
        embeds: [successEmbed(t('Account Age Updated'), t`Minimum account age requirement set to **${days} days**.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId, client);
}