// giveawayService.js

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';
import { getColor, botConfig } from '../config/bot.js';
import { getEndedGiveaways, markGiveawayEnded } from '../utils/database.js';
import { checkRateLimit, getRateLimitStatus } from '../utils/rateLimiter.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { t, enterLocale } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';

const GIVEAWAY_CONFIG = botConfig.giveaways || {};
const GIVEAWAY_INTERACTION_COOLDOWN = 1000;

function getGiveawayInteractionKey(userId, giveawayId) {
    return `giveaway:${userId}:${giveawayId}`;
}

export function parseDuration(durationString) {
    if (!durationString || typeof durationString !== 'string') {
        throw new TitanBotError(
            'Invalid duration format provided',
            ErrorTypes.VALIDATION,
            t('Please provide a valid duration (e.g., 1h, 30m, 5d, 10s).'),
            { durationString }
        );
    }

    const regex = /^(\d+)([hmds])$/i;
    const match = durationString.trim().match(regex);

    if (!match) {
        throw new TitanBotError(
            `Invalid duration format: ${durationString}`,
            ErrorTypes.VALIDATION,
            t('Invalid duration format. Use: 1h, 30m, 5d, 10s (min: 10s, max: 30d)'),
            { input: durationString }
        );
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (amount <= 0 || amount > 999) {
        throw new TitanBotError(
            `Duration amount out of range: ${amount}`,
            ErrorTypes.VALIDATION,
            t('Duration amount must be between 1 and 999.'),
            { amount, unit }
        );
    }

    let ms = 0;
    switch (unit) {
        case 's':
            ms = amount * 1000;
            break;
        case 'm':
            ms = amount * 60 * 1000;
            break;
        case 'h':
            ms = amount * 60 * 60 * 1000;
            break;
        case 'd':
            ms = amount * 24 * 60 * 60 * 1000;
            break;
        default:
            throw new TitanBotError(
                `Unknown duration unit: ${unit}`,
                ErrorTypes.VALIDATION,
                t('Please use s (seconds), m (minutes), h (hours), or d (days).'),
                { unit }
            );
    }

    const maxDuration = GIVEAWAY_CONFIG.maximumDuration ?? 30 * 24 * 60 * 60 * 1000;
    if (ms > maxDuration) {
        throw new TitanBotError(
            `Duration exceeds maximum: ${ms}ms > ${maxDuration}ms`,
            ErrorTypes.VALIDATION,
            t`Maximum duration is ${Math.floor(maxDuration / (24 * 60 * 60 * 1000))} days.`,
            { requestedMs: ms, maxMs: maxDuration }
        );
    }

    const minDuration = GIVEAWAY_CONFIG.minimumDuration ?? 10 * 1000;
    if (ms < minDuration) {
        throw new TitanBotError(
            `Duration below minimum: ${ms}ms < ${minDuration}ms`,
            ErrorTypes.VALIDATION,
            t`Minimum duration is ${Math.ceil(minDuration / 1000)} seconds.`,
            { requestedMs: ms, minMs: minDuration }
        );
    }

    return ms;
}

export function validatePrize(prize) {
    if (!prize || typeof prize !== 'string') {
        throw new TitanBotError(
            'Prize must be a non-empty string',
            ErrorTypes.VALIDATION,
            t('Please provide a valid prize description.'),
            { prize }
        );
    }

    const trimmed = prize.trim();
    if (trimmed.length === 0 || trimmed.length > 256) {
        throw new TitanBotError(
            `Prize length out of range: ${trimmed.length}`,
            ErrorTypes.VALIDATION,
            t('Prize must be between 1 and 256 characters.'),
            { length: trimmed.length }
        );
    }

    return trimmed;
}

export function validateWinnerCount(winnerCount) {
    const minimumWinners = GIVEAWAY_CONFIG.minimumWinners ?? 1;
    const maximumWinners = GIVEAWAY_CONFIG.maximumWinners ?? 10;

    if (!Number.isInteger(winnerCount) || winnerCount < minimumWinners || winnerCount > maximumWinners) {
        throw new TitanBotError(
            `Invalid winner count: ${winnerCount}`,
            ErrorTypes.VALIDATION,
            t`Winner count must be between ${minimumWinners} and ${maximumWinners}.`,
            { winnerCount, minimumWinners, maximumWinners }
        );
    }
}

/** Lines describing who may enter and which roles get extra entries. */
export function describeGiveawayRules(giveaway) {
    const rules = giveaway.requirements ?? {};
    const requirements = [];
    if (rules.roleId) requirements.push(t`• Role <@&${rules.roleId}>`);
    if (rules.minLevel) requirements.push(t`• Level ${rules.minLevel} or higher`);
    if (rules.minInvites) requirements.push(t`• At least ${rules.minInvites} {0|invite|invites}`);
    if (rules.minAccountAgeDays) requirements.push(t`• Account older than ${rules.minAccountAgeDays} {0|day|days}`);
    if (rules.minMemberDays) requirements.push(t`• On this server for at least ${rules.minMemberDays} {0|day|days}`);
    const bonus = (giveaway.bonusEntries ?? []).map((entry) => t`• <@&${entry.roleId}>: +${entry.entries} {1|entry|entries}`);
    return { requirements, bonus };
}

export function createGiveawayEmbed(giveaway, status, winners = []) {
    try {
        const isEnded = status === 'ended' || status === 'reroll';
        const endTime = giveaway.endsAt || giveaway.endTime;
        const endSeconds = Math.floor(endTime / 1000);
        const entryCount = giveaway.participants?.length ?? 0;
        const { requirements, bonus } = describeGiveawayRules(giveaway);

        const lines = [];
        if (isEnded) {
            lines.push(
                winners.length > 0
                    ? t`🎊 **Winners:** ${winners.map((id) => `<@${id}>`).join(', ')}`
                    : t('😔 **Nobody entered, so there is no winner.**'),
                '',
                t`👤 **Hosted by:** <@${giveaway.hostId}>`,
                t`👥 **Entries:** ${entryCount}`,
            );
        } else {
            lines.push(
                t('Click the button below to enter!'),
                '',
                t`⏰ **Ends:** <t:${endSeconds}:R> (<t:${endSeconds}:f>)`,
                t`👤 **Hosted by:** <@${giveaway.hostId}>`,
                t`🏆 **Winners:** ${giveaway.winnerCount}`,
            );
            if (requirements.length > 0) lines.push('', t('📋 **Requirements**'), ...requirements);
            if (bonus.length > 0) lines.push('', t('🎟️ **Extra entries**'), ...bonus);
        }

        return new EmbedBuilder()
            .setTitle(`${status === 'reroll' ? '🔄' : '🎉'} ${giveaway.prize}`)
            .setDescription(lines.join('\n'))
            .setColor(isEnded ? getColor('giveaway.ended') : getColor('giveaway.active'))
            .setFooter({ text: isEnded ? t('Giveaway ended') : t('Ends') })
            .setTimestamp(isEnded ? new Date() : new Date(endTime));
    } catch (error) {
        logger.error('Error creating giveaway embed:', error);
        throw new TitanBotError(
            'Failed to create giveaway embed',
            ErrorTypes.UNKNOWN,
            t('An internal error occurred while formatting the giveaway.'),
            { error: error.message }
        );
    }
}

/**
 * @param {boolean} ended
 * @param {number|null} entryCount shown on the Join button so the count is visible at a glance
 */
export function createGiveawayButtons(ended = false, entryCount = null) {
    try {
        const row = new ActionRowBuilder();

        if (ended) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_reroll')
                    .setLabel(t('🎲 Reroll'))
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('giveaway_view')
                    .setLabel(t('👁️ View Winners'))
                    .setStyle(ButtonStyle.Primary)
            );
        } else {
            const joinLabel = Number.isInteger(entryCount) ? `${t('🎉 Join')} · ${entryCount}` : t('🎉 Join');
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_join')
                    .setLabel(joinLabel)
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('giveaway_end')
                    .setLabel(t('🛑 End'))
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        return row;
    } catch (error) {
        logger.error('Error creating giveaway buttons:', error);
        throw new TitanBotError(
            'Failed to create giveaway buttons',
            ErrorTypes.UNKNOWN,
            t('An internal error occurred while creating interactive buttons.'),
            { error: error.message }
        );
    }
}

/**
 * Pick winners at random. `tickets` ({ userId: count }) gives some members more
 * than one entry; everyone else counts once. Nobody can win twice.
 */
export function selectWinners(participants, winnerCount, tickets = null) {
    if (!Array.isArray(participants) || participants.length === 0) {
        return [];
    }

    if (!Number.isInteger(winnerCount) || winnerCount < 1) {
        throw new TitanBotError(
            'Invalid winner count for selection',
            ErrorTypes.VALIDATION,
            t('Winner count must be at least 1.'),
            { winnerCount }
        );
    }

    const pool = [...new Set(participants)].map((id) => ({
        id,
        weight: Math.max(1, Math.floor(Number(tickets?.[id])) || 1),
    }));
    const requested = Math.min(winnerCount, pool.length);
    const winners = [];

    while (winners.length < requested) {
        const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = Math.random() * total;
        let index = pool.findIndex((entry) => {
            roll -= entry.weight;
            return roll < 0;
        });
        if (index === -1) index = pool.length - 1;
        winners.push(pool.splice(index, 1)[0].id);
    }

    return winners;
}

export function isUserRateLimited(userId, giveawayId) {
    const status = getRateLimitStatus(
        getGiveawayInteractionKey(userId, giveawayId),
        GIVEAWAY_INTERACTION_COOLDOWN,
    );
    return status.attempts >= 1 && status.remaining > 0;
}

export async function recordUserInteraction(userId, giveawayId) {
    await checkRateLimit(
        getGiveawayInteractionKey(userId, giveawayId),
        1,
        GIVEAWAY_INTERACTION_COOLDOWN,
    );
}

export async function endGiveaway(client, giveaway, guildId, endedBy) {
    try {
        if (!giveaway) {
            throw new TitanBotError(
                'Giveaway object is null or undefined',
                ErrorTypes.VALIDATION,
                t('Cannot end a non-existent giveaway.'),
                { giveaway }
            );
        }

        if (giveaway.ended === true || giveaway.isEnded === true) {
            throw new TitanBotError(
                `Giveaway ${giveaway.messageId} is already ended`,
                ErrorTypes.VALIDATION,
                t('This giveaway has already ended.'),
                { giveawayId: giveaway.messageId, status: 'already_ended' }
            );
        }

        const participants = giveaway.participants || [];
        const winners = selectWinners(participants, giveaway.winnerCount || 1, giveaway.tickets);

        const updatedGiveaway = {
            ...giveaway,
            ended: true,
            isEnded: true,
            winnerIds: winners,
            endedAt: new Date().toISOString(),
            endedBy: endedBy,
            participantCount: participants.length
        };

        logger.info(`Ending giveaway ${giveaway.messageId}: selected ${winners.length} winners from ${participants.length} entries`);

        return {
            giveaway: updatedGiveaway,
            winners: winners,
            participantCount: participants.length
        };
    } catch (error) {
        if (error instanceof TitanBotError) {
            logger.debug(`Giveaway end validation error: ${error.message}`, error.context || {});
            throw error;
        }
        logger.error('Error ending giveaway:', error);
        throw new TitanBotError(
            'Failed to end giveaway',
            ErrorTypes.UNKNOWN,
            t('An error occurred while ending the giveaway.'),
            { error: error.message, giveawayId: giveaway?.messageId }
        );
    }
}

export async function checkGiveaways(client) {
  try {
    if (!client.db) {
      logger.warn('Database not available for giveaway check');
      return;
    }

    const endedGiveaways = await getEndedGiveaways(client);
    
    if (endedGiveaways.length === 0) {
      return;
    }

    logger.info(`Processing ${endedGiveaways.length} ended giveaways`);

    for (const giveawayRecord of endedGiveaways) {
      try {
        const { id: giveawayId, guild_id: guildId, message_id: messageId, data: giveawayData } = giveawayRecord;
        const giveaway = typeof giveawayData === 'string' ? JSON.parse(giveawayData) : giveawayData;

        enterLocale(await getGuildLocale(client, guildId));
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          logger.debug(`Guild ${guildId} not found, skipping giveaway ${messageId}`);
          continue;
        }

        const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
        if (!channel) {
          logger.debug(`Channel ${giveaway.channelId} not found for giveaway ${messageId}`);
          continue;
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
          logger.debug(`Message ${messageId} not found for giveaway in channel ${giveaway.channelId}`);
          continue;
        }

        const participants = giveaway.participants || [];
        const winners = selectWinners(participants, giveaway.winnerCount || 1, giveaway.tickets);

        const winnerMentions = winners.length > 0
          ? winners.map(id => `<@${id}>`).join(', ')
          : t('No valid entries!');

        const endedEmbed = createGiveawayEmbed(giveaway, 'ended', winners);

        await message.edit({
          embeds: [endedEmbed],
          components: [createGiveawayButtons(true)]
        });

        giveaway.ended = true;
        giveaway.isEnded = true;
        giveaway.winnerIds = winners;
        giveaway.endedAt = new Date().toISOString();

        const markedSuccess = await markGiveawayEnded(client, giveawayId, giveaway);
        if (!markedSuccess) {
          logger.warn(`Failed to mark giveaway ${messageId} as ended in database`);
        }

        if (winners.length > 0) {
          const winnerAnnouncement = t`🎉 Congratulations ${winnerMentions}! You won the **${giveaway.prize || 'giveaway'}**! Please contact <@${giveaway.hostId}> to claim your prize.`;
          const winnerPingMsg = await channel.send({ content: winnerAnnouncement });
          giveaway.winnerPingMessageId = winnerPingMsg.id;
          await markGiveawayEnded(client, giveawayId, giveaway);

          try {
            await logEvent({
              client,
              guildId,
              eventType: EVENT_TYPES.GIVEAWAY_WINNER,
              data: {
                description: t`Giveaway ended with ${winners.length} winner(s)`,
                channelId: channel.id,
                fields: [
                  {
                    name: t('🎁 Prize'),
                    value: giveaway.prize || t('Mystery Prize!'),
                    inline: true
                  },
                  {
                    name: t('🏆 Winners'),
                    value: winners.map(id => `<@${id}>`).join(', '),
                    inline: false
                  },
                  {
                    name: t('👥 Entries'),
                    value: participants.length.toString(),
                    inline: true
                  }
                ]
              }
            });
          } catch (error) {
            logger.debug('Error logging giveaway winner:', error);
          }
        } else {
          await channel.send({ content: t`The giveaway for **${giveaway.prize}** has ended with no valid entries.` });
        }

        logger.info(`Ended giveaway ${messageId} in guild ${guildId}`);
      } catch (error) {
        logger.error(`Error processing giveaway:`, error);
      }
    }
  } catch (error) {
    logger.error('Error checking giveaways:', error);
  }
}