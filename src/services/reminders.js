// reminders.js — /przypomnienia: a DM when a member's break is over (2026-11-01, owner picked the idea from my list).
//
// Each member turns on the kinds they want; nobody gets a DM without asking for it. Every minute the job reads
// only those members. A kind fires once per use: `sent[kind]` keeps the marker of what was already reminded, and
// using the command changes the marker. Everything ready at once goes in one DM, at most one DM per MIN_GAP_MS and
// none between QUIET_FROM and QUIET_TO Polish time (young members). DMs that are closed mark the member `blocked`.
// Server switch: settings.reminders.enabled (web panel).
//
// Store guild:{id}:reminders = { members: { [userId]: { kinds: [...], sent: { [kind]: marker }, lastDmAt, blocked } } }.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { getEconomyData } from '../utils/economy.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { dayKey, warsawHour } from '../utils/warsawTime.js';
import { enterLocale, t } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';
import { cooldownMs, getEconomySettings } from './economySettings.js';
import { staminaCooldown, withEconomyLock } from './economyUpgrades.js';
import { PROPERTIES, ownedProperty, waitingRent } from './properties.js';
import { todaysGame } from './wordle.js';
import { openSeason, seasonActive, seasonData } from './seasonalEvents.js';

export const QUIET_FROM = 22;
export const QUIET_TO = 8;
export const MIN_GAP_MS = 10 * 60_000;
const MAX_DMS_PER_RUN = 20;
const LOCK = '#reminders';
const DM_CLOSED = 50007;
const GONE_CODES = new Set([10007, 10013]); // Unknown Member, Unknown User

export const SELECT_ID = 'przypomnienia:wybierz';
export const STOP_ID = 'przypomnienia:wylacz';

const store = guildStore('reminders', { members: {} });
export const getReminders = (guildId) => store.get(guildId);

/** A job with a break: ready when the break (shortened by Stamina) and any jail are over. Never used = nothing to remind. */
function breakOver(userData, settings, last, command, now) {
  if (!last) return null;
  const readyAt = last + staminaCooldown(userData, cooldownMs(settings.commands[command].cooldownMinutes));
  return now >= Math.max(readyAt, Number(userData.jailedUntil) || 0) ? String(last) : null;
}

// ready(...) returns the marker of what is ready now, or null. It may be async.
export const REMINDER_KINDS = Object.freeze([
  {
    id: 'daily', emoji: '📅', label: () => t('Daily reward'), line: () => t('`/daily` is ready'),
    ready: (userData, settings, now) => {
      const last = Number(userData.lastDaily) || 0;
      return now >= last + cooldownMs(settings.commands.daily.cooldownMinutes) ? String(last) : null;
    },
  },
  { id: 'work', emoji: '💼', label: () => t('Work'), line: () => t('`/work`: the break is over'), ready: (u, s, now) => breakOver(u, s, Number(u.lastWork) || 0, 'work', now) },
  { id: 'fish', emoji: '🎣', label: () => t('Fishing'), line: () => t('`/fish`: the break is over'), ready: (u, s, now) => breakOver(u, s, Number(u.lastFish) || 0, 'fish', now) },
  { id: 'nagraj', emoji: '🎬', label: () => t('Recording'), line: () => t('`/nagraj`: the break is over'), ready: (u, s, now) => breakOver(u, s, Number(u.lastMine) || 0, 'mine', now) },
  { id: 'beg', emoji: '🙏', label: () => t('Begging'), line: () => t('`/beg`: the break is over'), ready: (u, s, now) => breakOver(u, s, Number(u.lastBeg) || 0, 'beg', now) },
  { id: 'crime', emoji: '🦹', label: () => t('Crime'), line: () => t('`/crime`: the break is over'), ready: (u, s, now) => breakOver(u, s, Number(u.cooldowns?.crime) || 0, 'crime', now) },
  { id: 'slut', emoji: '💋', label: () => t('Risky work'), line: () => t('`/slut`: the break is over'), ready: (u, s, now) => breakOver(u, s, Number(u.lastSlut) || 0, 'slut', now) },
  { id: 'rob', emoji: '🥷', label: () => t('Robbery'), line: () => t('`/rob`: the break is over'), ready: (u, s, now) => breakOver(u, s, Number(u.lastRob) || 0, 'rob', now) },
  {
    // Rent stops growing when a building is full, so that is the moment worth a DM.
    id: 'rent', emoji: '🏠', label: () => t('Full rent'), line: () => t('`/nieruchomosci odbierz`: a building is full of rent'),
    ready: (userData, settings, now) => {
      const full = PROPERTIES.flatMap((property) => {
        const owned = ownedProperty(userData, property.id);
        return owned && waitingRent(settings, property, owned, now).full ? [`${property.id}:${owned.collectedAt}`] : [];
      });
      return full.length ? full.join(',') : null;
    },
  },
  {
    id: 'wordle', emoji: '🟩', label: () => t('New Wordle'), line: () => t('`/wordle`: a new word is waiting'),
    ready: (userData, settings, now) => (todaysGame(userData, now).done ? null : dayKey(now)),
  },
  {
    id: 'event', emoji: '🎁', label: () => t('Holiday event collection'), line: () => t('`/event zbierz`: today\'s collection is waiting'),
    ready: async (userData, settings, now, guildId) => {
      const open = await openSeason(guildId, now);
      if (!open || !seasonActive(open.settings, now)) return null;
      const today = dayKey(now);
      return seasonData(open.event, userData).lastDaily === today ? null : `${open.event.id}:${today}`;
    },
  },
]);
const KNOWN_KINDS = new Set(REMINDER_KINDS.map((kind) => kind.id));

export const inQuietHours = (now = Date.now()) => {
  const hour = warsawHour(now);
  return hour >= QUIET_FROM || hour < QUIET_TO;
};

/** The kinds of this member that are ready and not yet reminded: [{ kind, marker }]. */
export async function dueKinds(entry, userData, settings, guildId, now = Date.now()) {
  const due = [];
  for (const kind of REMINDER_KINDS) {
    if (!entry.kinds?.includes(kind.id)) continue;
    const marker = await kind.ready(userData, settings, now, guildId);
    if (marker !== null && marker !== undefined && entry.sent?.[kind.id] !== marker) due.push({ kind, marker });
  }
  return due;
}

const stopRow = (guildId) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('Open the server')).setURL(`https://discord.com/channels/${guildId}`),
  new ButtonBuilder().setCustomId(`${STOP_ID}:${guildId}`).setStyle(ButtonStyle.Secondary).setLabel(t('Turn reminders off')),
);

function reminderMessage(guild, due) {
  return {
    embeds: [createEmbed({
      title: t`⏰ ${guild.name}`,
      description: due.map(({ kind }) => `${kind.emoji} ${kind.line()}`).join('\n'),
      color: '#30D158',
      footer: false,
    })],
    components: [stopRow(guild.id)],
  };
}

function updateEntry(guildId, userId, mutate) {
  return withEconomyLock(guildId, LOCK, () => store.update(guildId, (data) => {
    data.members ??= {};
    const entry = data.members[userId] ?? { kinds: [], sent: {} };
    const next = mutate(entry);
    if (next === null) delete data.members[userId];
    else data.members[userId] = entry;
  }));
}

/** Every minute, per server. Returns how many DMs went out. */
export async function tickReminders(client, guild, now = Date.now()) {
  const settings = await getEconomySettings(guild.id);
  if (settings.reminders?.enabled === false || inQuietHours(now)) return 0;
  const { members } = await getReminders(guild.id);

  let sent = 0;
  for (const [userId, entry] of Object.entries(members ?? {})) {
    if (sent >= MAX_DMS_PER_RUN) break;
    if (!entry.kinds?.length || entry.blocked || now - (Number(entry.lastDmAt) || 0) < MIN_GAP_MS) continue;

    const userData = await getEconomyData(client, guild.id, userId, { joint: false });
    const due = await dueKinds(entry, userData, settings, guild.id, now);
    if (!due.length) continue;

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch (error) {
      if (GONE_CODES.has(error?.code)) await updateEntry(guild.id, userId, () => null);
      continue;
    }

    try {
      await member.user.send(reminderMessage(guild, due));
      sent += 1;
      await updateEntry(guild.id, userId, (stored) => {
        stored.sent = { ...stored.sent };
        for (const { kind, marker } of due) stored.sent[kind.id] = marker;
        stored.lastDmAt = now;
      });
    } catch (error) {
      if (error?.code === DM_CLOSED) await updateEntry(guild.id, userId, (stored) => { stored.blocked = true; });
      else logger.warn(`Reminder not sent to ${userId} in guild ${guild.id}: ${error.message}`);
    }
  }
  return sent;
}

export async function runReminders(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(client, guild.id));
      await tickReminders(client, guild);
    } catch (error) {
      logger.warn(`Reminders failed in guild ${guild.id}: ${error.message}`);
    }
  }
}

/**
 * The member's choice from the menu. The first time, the bot sends a DM at once: that shows whether DMs are open.
 * Returns the stored entry.
 */
export async function setReminderKinds({ guild, user, kinds, now = Date.now() }) {
  const wanted = kinds.filter((id) => KNOWN_KINDS.has(id));
  const before = (await getReminders(guild.id)).members?.[user.id];
  const needsCheck = wanted.length > 0 && (!before?.kinds?.length || before.blocked);
  let blocked = false;
  if (needsCheck) {
    try {
      await user.send({
        embeds: [createEmbed({
          title: t`⏰ ${guild.name}`,
          description: t`Reminders are on. Nothing comes between ${QUIET_FROM}:00 and ${QUIET_TO}:00.`,
          color: '#30D158',
          footer: false,
        })],
        components: [stopRow(guild.id)],
      });
    } catch (error) {
      if (error?.code !== DM_CLOSED) logger.warn(`Reminder check not sent to ${user.id}: ${error.message}`);
      blocked = true;
    }
  }
  await updateEntry(guild.id, user.id, (entry) => {
    entry.kinds = wanted;
    entry.blocked = needsCheck ? blocked : Boolean(entry.blocked);
    if (needsCheck && !blocked) entry.lastDmAt = now;
  });
  return (await getReminders(guild.id)).members[user.id];
}

export const stopReminders = (guildId, userId) => updateEntry(guildId, userId, (entry) => { entry.kinds = []; entry.blocked = false; });

/** The private view of /przypomnienia. */
export function buildRemindersView({ guildId, ownerId, entry, enabled = true }) {
  const chosen = entry?.kinds ?? [];
  const lines = [
    t('Pick what the bot should tell you in a DM when it is ready. Each thing comes once, after you use the command again it can come again.'),
    '',
    chosen.length
      ? REMINDER_KINDS.filter((kind) => chosen.includes(kind.id)).map((kind) => `${kind.emoji} ${kind.label()}`).join('\n')
      : t('Nothing is on now.'),
    '',
    t`🌙 Nothing comes between ${QUIET_FROM}:00 and ${QUIET_TO}:00. At most one DM every ${MIN_GAP_MS / 60_000} minutes.`,
  ];
  if (entry?.blocked) lines.unshift(t('⚠️ The bot cannot write to you. Allow DMs from this server, then pick again.'), '');
  if (!enabled) lines.unshift(t('⚠️ Reminders are turned off on this server.'), '');

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${SELECT_ID}:${ownerId}`)
    .setPlaceholder(t('What should I remind you about?'))
    .setMinValues(0)
    .setMaxValues(REMINDER_KINDS.length)
    .addOptions(REMINDER_KINDS.map((kind) => ({ label: kind.label(), value: kind.id, emoji: kind.emoji, default: chosen.includes(kind.id) })));
  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (chosen.length) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`${STOP_ID}:${guildId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('Turn everything off'))));
  }
  return { embeds: [createEmbed({ title: t('⏰ Reminders'), description: lines.join('\n'), color: '#5865F2', footer: false })], components: rows };
}
