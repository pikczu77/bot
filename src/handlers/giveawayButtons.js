import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError, replyUserError } from '../utils/errorHandler.js';
import { 
    getGuildGiveaways, 
    saveGiveaway, 
    isGiveawayEnded 
} from '../utils/giveaways.js';
import { Mutex } from '../utils/mutex.js';
import { 
    selectWinners,
    isUserRateLimited,
    recordUserInteraction,
    createGiveawayEmbed,
    createGiveawayButtons
} from '../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { t } from '../i18n/index.js';
import { checkGiveawayEntry } from '../services/giveawayRules.js';

export const giveawayJoinHandler = {
    customId: 'giveaway_join',
    async execute(interaction, client) {
        try {
            
            if (isUserRateLimited(interaction.user.id, interaction.message.id)) {
                return replyUserError(interaction, { type: ErrorTypes.RATE_LIMIT, message: t('Please wait a moment before interacting with this giveaway again.') });
            }

            await recordUserInteraction(interaction.user.id, interaction.message.id);

            const lockKey = `giveaway:${interaction.message.id}`;
            await Mutex.runExclusive(lockKey, async () => {
                const guildGiveaways = await getGuildGiveaways(client, interaction.guildId);
                const giveaway = guildGiveaways.find(g => g.messageId === interaction.message.id);

                if (!giveaway) {
                    throw new TitanBotError(
                        'Giveaway not found in database',
                        ErrorTypes.VALIDATION,
                        t('This giveaway is no longer active.'),
                        { messageId: interaction.message.id, guildId: interaction.guildId }
                    );
                }

                const endedByTime = isGiveawayEnded(giveaway);
                const endedByFlag = giveaway.ended || giveaway.isEnded;

                if (endedByTime || endedByFlag) {
                    return replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: t('This giveaway has already ended.') });
                }

                const participants = giveaway.participants || [];
                const userId = interaction.user.id;
                giveaway.tickets ??= {};

                // Clicking again leaves the giveaway.
                if (participants.includes(userId)) {
                    giveaway.participants = participants.filter((id) => id !== userId);
                    delete giveaway.tickets[userId];
                    await saveGiveaway(client, interaction.guildId, giveaway);
                    await interaction.message.edit({
                        embeds: [createGiveawayEmbed(giveaway, 'active')],
                        components: [createGiveawayButtons(false, giveaway.participants.length)]
                    });
                    return interaction.reply({
                        embeds: [successEmbed(t('You left the giveaway. Click the button again to rejoin.'))],
                        flags: MessageFlags.Ephemeral
                    });
                }

                const entry = await checkGiveawayEntry(client, interaction.member, giveaway);
                if (!entry.ok) {
                    return replyUserError(interaction, {
                        type: ErrorTypes.PERMISSION,
                        message: [t('You cannot enter this giveaway yet:'), ...entry.missing].join('\n'),
                    });
                }

                participants.push(userId);
                giveaway.participants = participants;
                if (entry.tickets > 1) giveaway.tickets[userId] = entry.tickets;

                await saveGiveaway(client, interaction.guildId, giveaway);

                logger.debug(`User ${interaction.user.tag} joined giveaway ${interaction.message.id}`);

                await interaction.message.edit({
                    embeds: [createGiveawayEmbed(giveaway, 'active')],
                    components: [createGiveawayButtons(false, participants.length)]
                });

                await interaction.reply({
                    embeds: [
                        successEmbed(
                            t('You are in! 🎉'),
                            entry.tickets > 1
                                ? t`Good luck! You have **${entry.tickets}** entries thanks to your roles.`
                                : t('Good luck! Click the button again if you want to leave.')
                        )
                    ],
                    flags: MessageFlags.Ephemeral
                });
            });
        } catch (error) {
            logger.error('Error in giveaway join handler:', error);
            await handleInteractionError(interaction, error, {
                type: 'button',
                customId: 'giveaway_join',
                handler: 'giveaway'
            });
        }
    }
};

export const giveawayEndHandler = {
    customId: 'giveaway_end',
    async execute(interaction, client) {
        try {
            
            if (!interaction.inGuild()) {
                throw new TitanBotError(
                    'Button used outside guild',
                    ErrorTypes.VALIDATION,
                    t('This button can only be used in a server.'),
                    { userId: interaction.user.id }
                );
            }

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: t('You need the \'Manage Server\' permission to end a giveaway.') });
            }

            const guildGiveaways = await getGuildGiveaways(client, interaction.guildId);
            const giveaway = guildGiveaways.find(g => g.messageId === interaction.message.id);

            if (!giveaway) {
                throw new TitanBotError(
                    'Giveaway not found in database',
                    ErrorTypes.VALIDATION,
                    t('This giveaway is no longer active.'),
                    { messageId: interaction.message.id, guildId: interaction.guildId }
                );
            }

            if (giveaway.ended || giveaway.isEnded || isGiveawayEnded(giveaway)) {
                throw new TitanBotError(
                    'Giveaway already ended',
                    ErrorTypes.VALIDATION,
                    t('This giveaway has already ended.'),
                    { messageId: interaction.message.id }
                );
            }

            const participants = giveaway.participants || [];
            const winners = selectWinners(participants, giveaway.winnerCount, giveaway.tickets);

            giveaway.ended = true;
            giveaway.isEnded = true;
            giveaway.winnerIds = winners;
            giveaway.endedAt = new Date().toISOString();
            giveaway.endedBy = interaction.user.id;

            await saveGiveaway(client, interaction.guildId, giveaway);

            logger.info(`Giveaway ended via button by ${interaction.user.tag}: ${interaction.message.id}`);

            const updatedEmbed = createGiveawayEmbed(giveaway, 'ended', winners);
            const updatedRow = createGiveawayButtons(true);

            await interaction.message.edit({
                content: t('🎉 **GIVEAWAY ENDED** 🎉'),
                embeds: [updatedEmbed],
                components: [updatedRow]
            });

            try {
                await logEvent({
                    client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_WINNER,
                    data: {
                        description: t`Giveaway ended with ${winners.length} winner(s)`,
                        channelId: interaction.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: t('🎁 Prize'),
                                value: giveaway.prize || t('Mystery Prize!'),
                                inline: true
                            },
                            {
                                name: t('🏆 Winners'),
                                value: winners.length > 0 
                                    ? winners.map(id => `<@${id}>`).join(', ')
                                    : t('No valid entries'),
                                inline: false
                            },
                            {
                                name: t('👥 Total Entries'),
                                value: participants.length.toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway end event:', logError);
            }

            await interaction.reply({
                embeds: [
                    successEmbed(
                        t`Giveaway Ended ✅`,
                        t`The giveaway has been ended and ${winners.length} winner(s) have been selected!`
                    )
                ],
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            logger.error('Error in giveaway end handler:', error);
            await handleInteractionError(interaction, error, {
                type: 'button',
                customId: 'giveaway_end',
                handler: 'giveaway'
            });
        }
    }
};

export const giveawayRerollHandler = {
    customId: 'giveaway_reroll',
    async execute(interaction, client) {
        try {
            
            if (!interaction.inGuild()) {
                throw new TitanBotError(
                    'Button used outside guild',
                    ErrorTypes.VALIDATION,
                    t('This button can only be used in a server.'),
                    { userId: interaction.user.id }
                );
            }

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: t('You need the \'Manage Server\' permission to reroll a giveaway.') });
            }

            const guildGiveaways = await getGuildGiveaways(client, interaction.guildId);
            const giveaway = guildGiveaways.find(g => g.messageId === interaction.message.id);

            if (!giveaway) {
                throw new TitanBotError(
                    'Giveaway not found in database',
                    ErrorTypes.VALIDATION,
                    t('This giveaway is no longer active.'),
                    { messageId: interaction.message.id, guildId: interaction.guildId }
                );
            }

            if (!giveaway.ended && !giveaway.isEnded) {
                throw new TitanBotError(
                    'Giveaway still active',
                    ErrorTypes.VALIDATION,
                    t('This giveaway has not ended yet. Please end it first.'),
                    { messageId: interaction.message.id }
                );
            }

            const participants = giveaway.participants || [];
            
            if (participants.length === 0) {
                throw new TitanBotError(
                    'No participants to reroll',
                    ErrorTypes.VALIDATION,
                    t('There are no entries to reroll from.'),
                    { messageId: interaction.message.id }
                );
            }

            const newWinners = selectWinners(participants, giveaway.winnerCount, giveaway.tickets);

            giveaway.winnerIds = newWinners;
            giveaway.rerolledAt = new Date().toISOString();
            giveaway.rerolledBy = interaction.user.id;

            await saveGiveaway(client, interaction.guildId, giveaway);

            logger.info(`Giveaway rerolled via button by ${interaction.user.tag}: ${interaction.message.id}`);

            const updatedEmbed = createGiveawayEmbed(giveaway, 'reroll', newWinners);
            const updatedRow = createGiveawayButtons(true);

            await interaction.message.edit({
                content: t('🔄 **GIVEAWAY REROLLED** 🔄'),
                embeds: [updatedEmbed],
                components: [updatedRow]
            });

            try {
                await logEvent({
                    client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                    data: {
                        description: t`Giveaway rerolled`,
                        channelId: interaction.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: t('🎁 Prize'),
                                value: giveaway.prize || t('Mystery Prize!'),
                                inline: true
                            },
                            {
                                name: t('🏆 New Winners'),
                                value: newWinners.map(id => `<@${id}>`).join(', '),
                                inline: false
                            },
                            {
                                name: t('👥 Total Entries'),
                                value: participants.length.toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway reroll event:', logError);
            }

            await interaction.reply({
                embeds: [
                    successEmbed(
                        t('Giveaway Rerolled ✅'),
                        t`New winner(s) have been selected!`
                    )
                ],
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            logger.error('Error in giveaway reroll handler:', error);
            await handleInteractionError(interaction, error, {
                type: 'button',
                customId: 'giveaway_reroll',
                handler: 'giveaway'
            });
        }
    }
};

export const giveawayViewHandler = {
    customId: 'giveaway_view',
    async execute(interaction, client) {
        try {
            if (!interaction.inGuild()) {
                throw new TitanBotError(
                    'Button used outside guild',
                    ErrorTypes.VALIDATION,
                    t('This button can only be used in a server.'),
                    { userId: interaction.user.id }
                );
            }

            const guildGiveaways = await getGuildGiveaways(client, interaction.guildId);
            const giveaway = guildGiveaways.find(g => g.messageId === interaction.message.id);

            if (!giveaway) {
                throw new TitanBotError(
                    'Giveaway not found in database',
                    ErrorTypes.VALIDATION,
                    t('This giveaway could not be found.'),
                    { messageId: interaction.message.id, guildId: interaction.guildId }
                );
            }

            if (!giveaway.ended && !giveaway.isEnded && !isGiveawayEnded(giveaway)) {
                return replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: t('This giveaway has not ended yet, so winners are not available.') });
            }

            const winnerIds = Array.isArray(giveaway.winnerIds) ? giveaway.winnerIds : [];
            const winnerMentions = winnerIds.length > 0
                ? winnerIds.map(id => `<@${id}>`).join(', ')
                : t('No valid winners were selected for this giveaway.');

            await interaction.reply({
                embeds: [
                    successEmbed(
                        t`Winners for ${giveaway.prize || t('this giveaway')} 🎉`,
                        winnerMentions
                    )
                ],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error('Error in giveaway view handler:', error);
            await handleInteractionError(interaction, error, {
                type: 'button',
                customId: 'giveaway_view',
                handler: 'giveaway'
            });
        }
    }
};