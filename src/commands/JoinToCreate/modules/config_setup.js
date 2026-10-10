import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { 
    getJoinToCreateConfig, 
    updateJoinToCreateConfig,
    removeJoinToCreateTrigger,
    addJoinToCreateTrigger
} from '../../../utils/database.js';
import { t } from '../../../i18n/index.js';

export default {
    async execute(interaction, config, client) {
        try {
            const triggerChannel = interaction.options.getChannel('trigger_channel');
        const guildId = interaction.guild.id;

        const currentConfig = await getJoinToCreateConfig(client, guildId);

        if (!currentConfig.triggerChannels.includes(triggerChannel.id)) {
            throw new TitanBotError(
                `Channel ${triggerChannel.id} is not a Join to Create trigger`,
                ErrorTypes.VALIDATION,
                t`${triggerChannel} is not configured as a Join to Create trigger channel.`
            );
        }

        const embed = new EmbedBuilder()
            .setTitle(t('Join to Create Configuration'))
            .setDescription(t`Configure settings for ${triggerChannel}`)
            .setColor(getColor('info'))
            .addFields(
                {
                    name: t('Current Channel Name Template'),
                    value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                    inline: false
                },
                {
                    name: t('Current User Limit'),
                    value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? t('No limit') : currentConfig.userLimit + ' users'}`,
                    inline: true
                },
                {
                    name: t('Current Bitrate'),
                    value: `${(currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000} kbps`,
                    inline: true
                }
            )
            .setFooter({ text: t('Select an option to configure below') })
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`jointocreate_config_${triggerChannel.id}`)
            .setPlaceholder(t('Select a configuration option'))
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(t('Change Channel Name Template'))
                    .setDescription(t('Modify the template for temporary channel names'))
                    .setValue('name_template'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(t('Change User Limit'))
                    .setDescription(t('Set maximum users per temporary channel'))
                    .setValue('user_limit'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(t('Change Bitrate'))
                    .setDescription(t('Adjust audio quality for temporary channels'))
                    .setValue('bitrate'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(t('Remove This Trigger Channel'))
                    .setDescription(t('Remove this channel from the Join to Create system'))
                    .setValue('remove_trigger'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(t('View Current Settings'))
                    .setDescription(t('Show all current configuration details'))
                    .setValue('view_settings')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            components: [row],
        }).catch(error => {
            logger.error('Failed to edit reply in config_setup:', error);
        });

        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => i.user.id === interaction.user.id && i.customId === `jointocreate_config_${triggerChannel.id}`,
time: 60000
        });

        collector.on('collect', async (selectInteraction) => {
            await selectInteraction.deferUpdate();

            const selectedOption = selectInteraction.values[0];

            try {
                switch (selectedOption) {
                    case 'name_template':
                        await handleNameTemplateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'user_limit':
                        await handleUserLimitChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'bitrate':
                        await handleBitrateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'remove_trigger':
                        await handleRemoveTrigger(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'view_settings':
                        await handleViewSettings(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                }
            } catch (error) {
                if (error instanceof TitanBotError) {
                    logger.debug(`Configuration validation error: ${error.message}`, error.context || {});
                } else {
                    logger.error('Unexpected configuration menu error:', error);
                }
                
                const errorMessage = error instanceof TitanBotError 
                    ? error.userMessage || t('An error occurred while processing your selection.')
                    : t('An error occurred while processing your selection.');
                    
                await replyUserError(selectInteraction, {
                    type: ErrorTypes.CONFIGURATION,
                    message: errorMessage
                }).catch(() => {});
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const disabledRow = new ActionRowBuilder().addComponents(
                    selectMenu.setDisabled(true)
                );
                
                await InteractionHelper.safeEditReply(interaction, {
                    components: [disabledRow],
                }).catch(() => {});
            }
        });
            } catch (error) {
            if (error instanceof TitanBotError) {
                throw error;
            }
            logger.error('Unexpected error in config_setup:', error);
            throw new TitanBotError(
                `Config setup failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                t('Failed to configure Join to Create system.')
            );
        }
    }
};

async function handleNameTemplateChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle(t('Channel Name Template Configuration'))
        .setDescription(t('Please enter the new channel name template.'))
        .addFields(
            {
                name: t('Available Variables'),
                value: t('• `{username}` - User\'s username\n• `{display_name}` - User\'s display name\n• `{user_tag}` - User\'s tag (User#1234)\n• `{guild_name}` - Server name'),
                inline: false
            },
            {
                name: t('Current Template'),
                value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: t('Type your new template in the chat below') });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id,
time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newTemplate = message.content.trim();
            
            if (!newTemplate || newTemplate.length > 100) {
                await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: t('Template must be between 1 and 100 characters.')
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                nameTemplate: newTemplate
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed(t('Template Updated'), t`Channel name template changed to \`${newTemplate}\``)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Template validation error: ${error.message}`);
            } else {
                logger.error('Template update error:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || t('Could not update the channel name template.')
                : t('Could not update the channel name template.');
                
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: errorMessage
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: t('No response received. Template update cancelled.')
            }).catch(() => {});
        }
    });
}

async function handleUserLimitChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle(t('User Limit Configuration'))
        .setDescription(t('Please enter the new user limit (0-99, where 0 = no limit).'))
        .addFields(
            {
                name: t('Current Limit'),
                value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? t('No limit') : currentConfig.userLimit + ' users'}`,
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: t('Type the new limit in the chat below') });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newLimit = parseInt(message.content.trim());
            
            if (newLimit < 0 || newLimit > 99) {
                await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: t('User limit must be between 0 and 99.')
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                userLimit: newLimit
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed(t('Limit Updated'), t`User limit changed to ${newLimit === 0 ? t('No limit') : newLimit + ' users'}`)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`User limit validation error: ${error.message}`);
            } else {
                logger.error('User limit update error:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || t('Could not update the user limit.')
                : t('Could not update the user limit.');
                
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: errorMessage
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: t('No valid response received. Update cancelled.')
            }).catch(() => {});
        }
    });
}

async function handleBitrateChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle(t('Bitrate Configuration'))
        .setDescription(t('Please enter the new bitrate in kbps (8-384).'))
        .addFields(
            {
                name: t('Current Bitrate'),
                value: `${(currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000} kbps`,
                inline: false
            },
            {
                name: t('Common Values'),
                value: t('• 64 kbps - Normal quality\n• 96 kbps - Good quality\n• 128 kbps - High quality\n• 256 kbps - Very high quality'),
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: t('Type the new bitrate in the chat below') });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newBitrate = parseInt(message.content.trim());
            
            if (newBitrate < 8 || newBitrate > 384) {
                await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: t('Bitrate must be between 8 and 384 kbps.')
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                bitrate: newBitrate * 1000
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed(t('Bitrate Updated'), t`Bitrate changed to ${newBitrate} kbps`)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Bitrate validation error: ${error.message}`);
            } else {
                logger.error('Bitrate update error:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || t('Could not update the bitrate.')
                : t('Could not update the bitrate.');
                
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: errorMessage
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: t('No valid response received. Update cancelled.')
            }).catch(() => {});
        }
    });
}

async function handleRemoveTrigger(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle(t('Remove Trigger Channel'))
        .setDescription(t`Are you sure you want to remove ${triggerChannel} from the Join to Create system?`)
        .setColor('#ff6600')
        .setFooter({ text: t('This action cannot be undone') });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_remove_${triggerChannel.id}`)
            .setLabel(t('Remove Channel'))
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`cancel_remove_${triggerChannel.id}`)
            .setLabel(t('Cancel'))
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.followUp({ 
        embeds: [embed], 
        components: [row],
        flags: MessageFlags.Ephemeral 
    });

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id && 
                     (i.customId === `confirm_remove_${triggerChannel.id}` || i.customId === `cancel_remove_${triggerChannel.id}`),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (buttonInteraction) => {
        await buttonInteraction.deferUpdate();

        if (buttonInteraction.customId === `confirm_remove_${triggerChannel.id}`) {
            try {
                const success = await removeJoinToCreateTrigger(client, interaction.guild.id, triggerChannel.id);
                
                if (success) {
                    await buttonInteraction.followUp({
                        embeds: [successEmbed(t('Channel Removed'), t`${triggerChannel} has been removed from the Join to Create system.`)],
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    await replyUserError(buttonInteraction, {
                        type: ErrorTypes.CONFIGURATION,
                        message: t('Could not remove the trigger channel.')
                    });
                }
            } catch (error) {
                if (error instanceof TitanBotError) {
                    logger.debug(`Trigger removal validation error: ${error.message}`);
                } else {
                    logger.error('Remove trigger error:', error);
                }
                
                const errorMessage = error instanceof TitanBotError
                    ? error.userMessage || t('An error occurred while removing the trigger channel.')
                    : t('An error occurred while removing the trigger channel.');
                    
                await replyUserError(buttonInteraction, {
                    type: ErrorTypes.CONFIGURATION,
                    message: errorMessage
                }).catch(() => {});
            }
        } else {
            await buttonInteraction.followUp({
                embeds: [successEmbed(t('Cancelled'), t('Channel removal has been cancelled.'))],
                flags: MessageFlags.Ephemeral,
            });
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            replyUserError(interaction, {
                type: ErrorTypes.RATE_LIMIT,
                message: t('No response received. Removal cancelled.')
            }).catch(() => {});
        }
    });
}

async function handleViewSettings(interaction, triggerChannel, currentConfig, client) {
    const channelConfig = currentConfig.channelOptions?.[triggerChannel.id] || {};
    
    const embed = new EmbedBuilder()
        .setTitle(t('Current Settings'))
        .setDescription(t`Configuration for ${triggerChannel}`)
        .setColor(getColor('info'))
        .addFields(
            {
                name: t('Trigger Channel'),
                value: `${triggerChannel} (${triggerChannel.id})`,
                inline: false
            },
            {
                name: t('Channel Name Template'),
                value: `\`${channelConfig.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            },
            {
                name: t('User Limit'),
                value: `${channelConfig.userLimit || currentConfig.userLimit === 0 ? t('No limit') : (channelConfig.userLimit || currentConfig.userLimit) + ' users'}`,
                inline: true
            },
            {
                name: t('Bitrate'),
                value: `${(channelConfig.bitrate || currentConfig.bitrate) / 1000} kbps`,
                inline: true
            },
            {
                name: t('Category'),
                value: currentConfig.categoryId ? `<#${currentConfig.categoryId}>` : t('Not set'),
                inline: true
            },
            {
                name: t('System Status'),
                value: currentConfig.enabled ? t('✅ Enabled') : t('❌ Disabled'),
                inline: true
            },
            {
                name: t('Active Temporary Channels'),
                value: Object.keys(currentConfig.temporaryChannels || {}).length.toString(),
                inline: true
            }
        )
        .setTimestamp();

    await interaction.followUp({ 
        embeds: [embed], 
        flags: MessageFlags.Ephemeral 
    });
}