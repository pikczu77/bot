// What the web panel does to a giveaway once it exists: new winners, or delete it (owner, 2026-10-30: everything on the site,
// these were /konkurs losuj-ponownie and /konkurs usun). Starting and ending are in src/api/panelApi.js and giveawayService.js.

import { logger } from '../utils/logger.js';
import { deleteGiveaway, saveGiveaway } from '../utils/giveaways.js';
import { createGiveawayButtons, createGiveawayEmbed, selectWinners } from './giveawayService.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { t } from '../i18n/index.js';

const messageOf = (guild, giveaway) => {
  const channel = guild.channels.cache.get(giveaway.channelId) ?? null;
  return channel?.messages?.fetch ? channel.messages.fetch(giveaway.messageId).catch(() => null) : null;
};

async function logGiveaway(client, guild, giveaway, eventType, description, fields) {
  try {
    await logEvent({ client, guildId: guild.id, eventType, data: { description, channelId: giveaway.channelId, userId: client.user?.id, fields } });
  } catch (error) {
    logger.debug('Error logging a giveaway change:', error);
  }
}

/** Pick new winners of a finished giveaway and announce them. Returns their ids. The caller checks there are enough entries. */
export async function rerollGiveaway(client, guild, giveaway) {
  const participants = giveaway.participants ?? [];
  const winners = selectWinners(participants, giveaway.winnerCount, giveaway.tickets);
  const updated = { ...giveaway, winnerIds: winners, rerolledAt: new Date().toISOString(), rerolledBy: client.user?.id ?? null };
  const channel = guild.channels.cache.get(giveaway.channelId) ?? null;

  const message = await messageOf(guild, giveaway);
  if (message) {
    await message.edit({
      content: t('🔄 **GIVEAWAY REROLLED** 🔄'),
      embeds: [createGiveawayEmbed(updated, 'reroll', winners)],
      components: [createGiveawayButtons(true)],
    }).catch((error) => logger.warn(`Could not edit giveaway ${giveaway.messageId}: ${error.message}`));
  }

  const mentions = winners.map((id) => `<@${id}>`).join(',');
  if (channel?.send) {
    const content = t`🔄 **REROLL WINNERS** 🔄 CONGRATULATIONS ${mentions}! You are the new winner(s) for the **${giveaway.prize}** giveaway! Please contact the host <@${giveaway.hostId}> to claim your prize.`;
    const oldPing = giveaway.winnerPingMessageId ? await channel.messages?.fetch?.(giveaway.winnerPingMessageId).catch(() => null) : null;
    if (oldPing) await oldPing.edit({ content }).catch(() => null);
    else updated.winnerPingMessageId = (await channel.send({ content }).catch(() => null))?.id ?? giveaway.winnerPingMessageId ?? null;
  }

  await saveGiveaway(client, guild.id, updated);
  await logGiveaway(client, guild, giveaway, EVENT_TYPES.GIVEAWAY_REROLL, t`Giveaway rerolled: ${giveaway.prize}`, [
    { name: t('Prize'), value: giveaway.prize || t('Mystery Prize!'), inline: true },
    { name: t('New Winners'), value: mentions || '-', inline: false },
    { name: t('Total Entries'), value: participants.length.toString(), inline: true },
  ]);
  return winners;
}

/** Delete the giveaway message and the giveaway itself. Returns false when it could not be removed from the store. */
export async function removeGiveaway(client, guild, giveaway) {
  const message = await messageOf(guild, giveaway);
  if (message) await message.delete().catch((error) => logger.warn(`Could not delete giveaway message ${giveaway.messageId}: ${error.message}`));
  const removed = await deleteGiveaway(client, guild.id, giveaway.messageId);
  if (removed) {
    await logGiveaway(client, guild, giveaway, EVENT_TYPES.GIVEAWAY_DELETE, t`Giveaway deleted: ${giveaway.prize}`, [
      { name: t('Prize'), value: giveaway.prize || t('Unknown'), inline: true },
      { name: t('Entries'), value: (giveaway.participants?.length || 0).toString(), inline: true },
    ]);
  }
  return removed;
}
