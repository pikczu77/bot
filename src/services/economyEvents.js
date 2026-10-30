// economyEvents.js — timed economy events (2026-10-26, owner: "eventy na czasówkę ... info na osobnym
// kanale i niech usuwa się po skończeniu").
//
// One event at a time per server, kept in the economy settings (`events`, economySettings.js):
//   { channelId, roleId, auto, everyHours, durationMinutes, active: { type, startedAt, endsAt, messageId, channelId } | null, nextAutoAt }
// An admin starts one in the web panel, or the bot starts a random one every `everyHours`
// when `auto` is on. The announcement goes to `channelId` (with an optional role ping) and is
// deleted when the event ends. Checked every minute (features.js).
//
// Effects (read by the commands):
//   kasa       every job payout x2 (scaleEarnings with the member's data: jobs, /daily, chat, level-up money)
//   ryby       /fish pays x2 and golden / diamond fish come 3x as often
//   youtube    /nagraj pays x2
//   szczescie  +5 luck in every casino game (also above the normal cap of 20)
//   paczki     /paczka packs cost half

import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { enterLocale, t, tr } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';
import { activeEventType, getEconomySettings, updateEconomySettings } from './economySettings.js';

export const EVENT_TYPES = [
  { id: 'kasa', emoji: '💸', name: t('Double money'), description: t('Every job pays double: `/work`, `/nagraj`, `/fish`, `/beg`, `/crime`, `/slut`, `/daily`, chat and level-up money.'), color: '#30D158' },
  { id: 'ryby', emoji: '🎣', name: t('Fishing frenzy'), description: t('`/fish` pays double and golden and diamond fish bite three times as often.'), color: '#0A84FF' },
  { id: 'youtube', emoji: '🎬', name: t('YouTube boom'), description: t('`/nagraj` pays double.'), color: '#FF453A' },
  { id: 'szczescie', emoji: '🍀', name: t('Lucky streak'), description: t('+5% win chance in every casino game, even above the usual limit.'), color: '#34C759' },
  { id: 'paczki', emoji: '📦', name: t('Pack sale'), description: t('Every `/paczka` pack costs half.'), color: '#BF5AF2' },
];
export const getEventType = (id) => EVENT_TYPES.find((type) => type.id === id) ?? null;

export const EVENT_LUCK = 5;
export const MIN_EVENT_MINUTES = 5;
export const MAX_EVENT_MINUTES = 7 * 24 * 60;

/** The running event type of a server (or null). */
export const runningEvent = (settings, now = Date.now()) => getEventType(activeEventType(settings, now));

/** x2 for /fish during "ryby", for /nagraj during "youtube"; 1 otherwise. */
export const eventPayFactor = (settings, kind, now = Date.now()) => {
  const type = activeEventType(settings, now);
  return (type === 'ryby' && kind === 'fish') || (type === 'youtube' && kind === 'mine') ? 2 : 1;
};
/** How much more often golden and diamond fish come (3 during "ryby"). */
export const eventVariantBoost = (settings, now = Date.now()) => (activeEventType(settings, now) === 'ryby' ? 3 : 1);
/** Extra casino luck during "szczescie". */
export const eventLuck = (settings, now = Date.now()) => (activeEventType(settings, now) === 'szczescie' ? EVENT_LUCK : 0);
/** Pack price during "paczki". */
export const eventPackPrice = (settings, price, now = Date.now()) => (activeEventType(settings, now) === 'paczki' ? Math.ceil(price / 2) : price);

/** "\n🎉 **Event: Fishing frenzy**" for a result of `kind` (fish, mine, casino, pack); '' otherwise. "kasa" is in earningsLine(). */
const EVENT_KINDS = { ryby: 'fish', youtube: 'mine', szczescie: 'casino', paczki: 'pack' };
export function eventLine(settings, kind, now = Date.now()) {
  const type = runningEvent(settings, now);
  return type && EVENT_KINDS[type.id] === kind ? t`\n🎉 **Event: ${tr(type.name)}**` : '';
}

function announcement(type, endsAt, roleId) {
  return {
    content: roleId ? `<@&${roleId}>` : undefined,
    embeds: [createEmbed({
      title: t`${type.emoji} EVENT: ${tr(type.name)}`,
      description: `${tr(type.description)}\n\n${t`⏰ Ends <t:${Math.floor(endsAt / 1000)}:R> (<t:${Math.floor(endsAt / 1000)}:t>).`}`,
      color: type.color,
      footer: false,
    })],
    allowedMentions: { roles: roleId ? [roleId] : [] },
  };
}

/**
 * Start `typeId` for `minutes` (ends a running event first). Posts the announcement when a
 * channel is set. Returns the saved settings.
 */
export async function startEvent(guild, typeId, minutes, { auto = false, now = Date.now() } = {}) {
  const type = getEventType(typeId);
  if (!type) throw createError('Unknown event', ErrorTypes.VALIDATION, t('Pick an event from the list.'), { typeId, expected: true });
  const duration = Math.round(Number(minutes));
  if (!(duration >= MIN_EVENT_MINUTES && duration <= MAX_EVENT_MINUTES)) {
    throw createError('Bad event length', ErrorTypes.VALIDATION, t`An event lasts from ${MIN_EVENT_MINUTES} minutes to 7 days.`, { minutes, expected: true });
  }
  await endEvent(guild, { now });
  const settings = await getEconomySettings(guild.id);
  const endsAt = now + duration * 60_000;
  let messageId = null;
  const channel = settings.events.channelId ? guild.channels.cache.get(settings.events.channelId) : null;
  if (channel?.send) {
    const message = await channel.send(announcement(type, endsAt, settings.events.roleId)).catch((error) => {
      logger.warn(`Economy event announcement not posted in guild ${guild.id}: ${error.message}`);
      return null;
    });
    messageId = message?.id ?? null;
  }
  return updateEconomySettings(guild.id, (data) => {
    data.events.active = { type: type.id, startedAt: now, endsAt, auto, channelId: channel?.id ?? null, messageId };
  });
}

/** End the running event (if any) and delete its announcement. Returns the ended type or null. */
export async function endEvent(guild, { now = Date.now() } = {}) {
  const settings = await getEconomySettings(guild.id);
  const active = settings.events.active;
  if (!active) return null;
  if (active.channelId && active.messageId) {
    const channel = guild.channels.cache.get(active.channelId);
    await channel?.messages?.delete?.(active.messageId).catch((error) => {
      logger.warn(`Economy event announcement not deleted in guild ${guild.id}: ${error.message}`);
    });
  }
  await updateEconomySettings(guild.id, (data) => {
    data.events.active = null;
    // An event started by hand also moves the next automatic one.
    if (data.events.auto && !(data.events.nextAutoAt > now)) data.events.nextAutoAt = nextAutoTime(data.events, now);
  });
  return getEventType(active.type);
}

/** When the next automatic event starts: `everyHours` from now, give or take a quarter. */
export function nextAutoTime(events, now = Date.now(), random = Math.random) {
  const hours = Math.max(1, Number(events.everyHours) || 24);
  return now + Math.round(hours * 3_600_000 * (0.75 + random() * 0.5));
}

/** Every minute: end events that are over, start an automatic one when it is time. */
export async function tickEconomyEvents(guild, now = Date.now(), random = Math.random) {
  const settings = await getEconomySettings(guild.id);
  const { active, auto } = settings.events;
  if (active && active.endsAt <= now) await endEvent(guild, { now });
  if (!auto) return;
  const fresh = await getEconomySettings(guild.id);
  if (fresh.events.active) return;
  if (!(fresh.events.nextAutoAt > 0)) {
    await updateEconomySettings(guild.id, (data) => { data.events.nextAutoAt = nextAutoTime(data.events, now, random); });
    return;
  }
  if (now < fresh.events.nextAutoAt) return;
  const type = EVENT_TYPES[Math.floor(random() * EVENT_TYPES.length)];
  await startEvent(guild, type.id, fresh.events.durationMinutes, { auto: true, now });
  await updateEconomySettings(guild.id, (data) => { data.events.nextAutoAt = nextAutoTime(data.events, now, random); });
}

export async function runEconomyEvents(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(guild.id));
      await tickEconomyEvents(guild);
    } catch (error) {
      logger.warn(`Economy events failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
