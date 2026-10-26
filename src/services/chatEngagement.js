// chatEngagement.js — things that get people writing on the main chat (2026-10-26, owner picked from my list
// "1,2,3,5 - zrob i ja chce zeby deadchat byl po 30 minutach bez gadania").
//
//   drops      while the chat is lively, now and then: "the first to type <word> gets money"
//   deadChat   after `minutes` (30) without a message in the daytime: ping the Dead Chat role with a topic
//   question   every day at `hour`: a question with a thread for answers; at the next question the answer with
//              the most reactions wins `reward`
//   happyHour  every day from `hour` for `minutes`: messages give more XP (services/happyHourState.js), with an
//              announcement on the chat that is deleted at the end
// All of it works on one chat channel (`channelId`). Checked every minute (features.js); messages are seen through
// handleChatMessage() in featureMessages.js (members only, bots do not count).
//
// Store guild:{id}:chat-engagement = { channelId, drops, deadChat, question, happyHour } and
// guild:{id}:chat-engagement-state = { question: { day, messageId, threadId, channelId }, happyHour: { day, messageId, channelId }, lastDeadPingAt }.

import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { enterLocale, t } from '../i18n/index.js';
import { dayKey, midnightOf, warsawHour } from '../utils/warsawTime.js';
import { DAILY_QUESTIONS, DEAD_CHAT_TOPICS, DROP_WORDS } from '../config/chatPrompts.js';
import { getGuildLocale } from './languageService.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { withEconomyLock } from './economyUpgrades.js';
import { recordProgress } from './progress.js';
import { setHappyHour } from './happyHourState.js';

export const CHAT_DEFAULTS = Object.freeze({
  channelId: null,
  drops: { enabled: true, minMinutes: 20, maxMinutes: 60, minMessages: 15, reward: 500 },
  deadChat: { enabled: true, minutes: 30, roleId: null, fromHour: 9, toHour: 23, minGapMinutes: 60 },
  question: { enabled: true, hour: 18, reward: 2000 },
  happyHour: { enabled: true, hour: 20, minutes: 60, percent: 200 },
});
export const DROP_MS = 60_000;
const DEAD_ROLE_RE = /dead\s*-?\s*chat|martwy\s*czat/i;

const store = guildStore('chat-engagement', structuredClone(CHAT_DEFAULTS));
const stateStore = guildStore('chat-engagement-state', { question: null, happyHour: null, lastDeadPingAt: 0 });

/** Settings with every part filled in (older stored settings miss new fields). */
export async function getChatSettings(guildId) {
  const stored = await store.get(guildId);
  const settings = structuredClone(CHAT_DEFAULTS);
  settings.channelId = stored.channelId ?? null;
  for (const part of ['drops', 'deadChat', 'question', 'happyHour']) Object.assign(settings[part], stored[part] ?? {});
  return settings;
}
export const updateChatSettings = (guildId, mutate) => store.update(guildId, mutate);
export const getChatState = (guildId) => stateStore.get(guildId);
const updateChatState = (guildId, mutate) => stateStore.update(guildId, mutate);

// guildId -> { lastMessageAt, messagesSinceDrop, deadPinged, nextDropAt, drop: { word, messageId, expiresAt, reward, message } }
const live = new Map();
function liveOf(guildId, now = Date.now()) {
  let entry = live.get(guildId);
  if (!entry) {
    // After a restart nobody is pinged at once: the quiet time counts from the start.
    entry = { lastMessageAt: now, messagesSinceDrop: 0, deadPinged: false, nextDropAt: 0, drop: null };
    live.set(guildId, entry);
  }
  return entry;
}
export const chatLive = (guildId) => live.get(guildId) ?? null;

const pick = (list, random) => list[Math.floor(random() * list.length)];
const normalize = (text) => String(text ?? '').trim().toLocaleLowerCase('pl').replace(/[.!?,\s]+$/u, '');

/** The Dead Chat role: the chosen one, else a role named like "Dead Chat". */
export function deadChatRole(guild, settings) {
  if (settings.deadChat.roleId) return guild.roles?.cache?.get(settings.deadChat.roleId) ?? null;
  return [...(guild.roles?.cache?.values?.() ?? [])].find((role) => DEAD_ROLE_RE.test(role.name ?? '')) ?? null;
}

// ---------------------------------------------------------------- messages

async function catchDrop(message, entry) {
  const drop = entry.drop;
  entry.drop = null;
  const guildId = message.guild.id;
  const settings = await getEconomySettings(guildId);
  const prize = await withEconomyLock(guildId, message.author.id, async () => {
    const userData = await getEconomyData(message.client, guildId, message.author.id);
    const amount = scaleEarnings(settings, drop.reward, userData);
    userData.wallet = (Number(userData.wallet) || 0) + amount;
    recordProgress(userData, { drop: 1 }, { settings });
    await setEconomyData(message.client, guildId, message.author.id, userData);
    return amount;
  });
  message.react('🎉').catch(() => {});
  await drop.message?.edit({
    embeds: [createEmbed({
      title: t('🎁 Drop caught!'),
      description: t`${message.author} was the fastest and gets **${money(guildId, prize)}**.`,
      color: '#30D158',
      footer: false,
    })],
  }).catch(() => {});
  return prize;
}

/** featureMessages.js: a member wrote. Tracks the chat and catches a drop. */
export async function handleChatMessage(message) {
  if (!message.guild || message.author?.bot) return false;
  const settings = await getChatSettings(message.guild.id);
  if (!settings.channelId || message.channelId !== settings.channelId) return false;
  const sentAt = message.createdTimestamp ?? Date.now();
  const entry = liveOf(message.guild.id, sentAt);
  entry.lastMessageAt = sentAt;
  entry.messagesSinceDrop += 1;
  entry.deadPinged = false;
  const drop = entry.drop;
  if (drop && sentAt <= drop.expiresAt && normalize(message.content) === drop.word) {
    await catchDrop(message, entry);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- drops

/** Post a drop now (also from the panel's "drop now"). Returns the word or null. */
export async function postDrop(guild, settings, { now = Date.now(), random = Math.random } = {}) {
  const channel = guild.channels.cache.get(settings.channelId);
  if (!channel?.send) return null;
  const entry = liveOf(guild.id, now);
  const word = pick(DROP_WORDS, random);
  const economy = await getEconomySettings(guild.id);
  const shown = scaleEarnings(economy, settings.drops.reward);
  const message = await channel.send({
    embeds: [createEmbed({
      title: t('🎁 Chat drop!'),
      description: t`The first to type **${word}** gets **${money(guild.id, shown)}**.\n-# ${Math.round(DROP_MS / 1000)} s`,
      color: '#F1C40F',
      footer: false,
    })],
  }).catch((error) => { logger.warn(`Chat drop not posted in guild ${guild.id}: ${error.message}`); return null; });
  if (!message) return null;
  entry.drop = { word, messageId: message.id, message, expiresAt: now + DROP_MS, reward: settings.drops.reward };
  entry.messagesSinceDrop = 0;
  entry.nextDropAt = now + (settings.drops.minMinutes + random() * Math.max(0, settings.drops.maxMinutes - settings.drops.minMinutes)) * 60_000;
  return word;
}

async function tickDrops(guild, settings, now, random) {
  const entry = liveOf(guild.id, now);
  if (entry.drop && now > entry.drop.expiresAt) {
    const old = entry.drop;
    entry.drop = null;
    await old.message?.edit({ embeds: [createEmbed({ title: t('🎁 Chat drop'), description: t`Nobody typed **${old.word}** in time.`, color: '#8E8E93', footer: false })] }).catch(() => {});
  }
  if (!settings.drops.enabled || entry.drop) return;
  if (!entry.nextDropAt) entry.nextDropAt = now + settings.drops.minMinutes * 60_000;
  // Only into a living chat: enough messages since the last drop and someone wrote in the last 5 minutes.
  if (now < entry.nextDropAt || entry.messagesSinceDrop < settings.drops.minMessages || now - entry.lastMessageAt > 5 * 60_000) return;
  await postDrop(guild, settings, { now, random });
}

// ---------------------------------------------------------------- dead chat

const inHours = (hour, from, to) => (from <= to ? hour >= from && hour < to : hour >= from || hour < to);

async function tickDeadChat(guild, settings, now, random) {
  const { deadChat } = settings;
  if (!deadChat.enabled) return false;
  const entry = liveOf(guild.id, now);
  if (entry.deadPinged || now - entry.lastMessageAt < deadChat.minutes * 60_000) return false;
  if (!inHours(warsawHour(now), deadChat.fromHour, deadChat.toHour)) return false;
  const state = await getChatState(guild.id);
  if (now - (Number(state.lastDeadPingAt) || 0) < deadChat.minGapMinutes * 60_000) return false;
  const channel = guild.channels.cache.get(settings.channelId);
  if (!channel?.send) return false;
  const role = deadChatRole(guild, settings);
  entry.deadPinged = true;
  await channel.send({
    content: role ? `<@&${role.id}>` : undefined,
    embeds: [createEmbed({
      title: t('💬 The chat fell asleep'),
      description: t`Topic to wake it up:\n**${pick(DEAD_CHAT_TOPICS, random)}**`,
      color: '#5865F2',
      footer: false,
    })],
    allowedMentions: { roles: role ? [role.id] : [] },
  }).catch((error) => logger.warn(`Dead chat ping failed in guild ${guild.id}: ${error.message}`));
  await updateChatState(guild.id, (data) => { data.lastDeadPingAt = now; });
  return true;
}

// ---------------------------------------------------------------- question of the day

const reactionCount = (message) => [...(message.reactions?.cache?.values?.() ?? [])]
  .reduce((sum, reaction) => sum + Math.max(0, (Number(reaction.count) || 0) - (reaction.me ? 1 : 0)), 0);

/** The most liked answer in yesterday's thread: { userId, count } or null. */
async function bestAnswer(guild, previous) {
  if (!previous?.threadId) return null;
  const thread = guild.channels.cache.get(previous.threadId) ?? await guild.channels.fetch?.(previous.threadId).catch(() => null);
  const messages = await thread?.messages?.fetch?.({ limit: 100 }).catch(() => null);
  let best = null;
  for (const message of [...(messages?.values?.() ?? [])].sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0))) {
    if (message.author?.bot) continue;
    const count = reactionCount(message);
    if (count > 0 && (!best || count > best.count)) best = { userId: message.author.id, count };
  }
  return best;
}

export async function postQuestion(guild, settings, { now = Date.now(), random = Math.random } = {}) {
  const channel = guild.channels.cache.get(settings.channelId);
  if (!channel?.send) return null;
  const state = await getChatState(guild.id);
  const winner = await bestAnswer(guild, state.question);
  let winnerLine = '';
  if (winner) {
    const economy = await getEconomySettings(guild.id);
    const prize = await withEconomyLock(guild.id, winner.userId, async () => {
      const userData = await getEconomyData(guild.client, guild.id, winner.userId);
      const amount = scaleEarnings(economy, settings.question.reward, userData);
      userData.wallet = (Number(userData.wallet) || 0) + amount;
      recordProgress(userData, { questionWin: 1 }, { settings: economy, now });
      await setEconomyData(guild.client, guild.id, winner.userId, userData);
      return amount;
    });
    winnerLine = t`🏆 Yesterday's best answer: <@${winner.userId}> (${winner.count} {1|reaction|reactions}) gets **${money(guild.id, prize)}**.\n\n`;
  }
  const used = new Set(state.recentQuestions ?? []);
  const fresh = DAILY_QUESTIONS.map((_, index) => index).filter((index) => !used.has(index));
  const index = pick(fresh.length ? fresh : DAILY_QUESTIONS.map((_, i) => i), random);
  const economy = await getEconomySettings(guild.id);
  const message = await channel.send({
    content: winner ? `<@${winner.userId}>` : undefined,
    embeds: [createEmbed({
      title: t('❓ Question of the day'),
      description: `${winnerLine}**${DAILY_QUESTIONS[index]}**\n\n${t`Answer in the thread below. The answer with the most reactions tomorrow gets **${money(guild.id, scaleEarnings(economy, settings.question.reward))}**.`}`,
      color: '#BF5AF2',
      footer: false,
    })],
    allowedMentions: { users: winner ? [winner.userId] : [] },
  }).catch((error) => { logger.warn(`Question of the day not posted in guild ${guild.id}: ${error.message}`); return null; });
  if (!message) return null;
  const thread = await message.startThread?.({ name: t('Answers'), autoArchiveDuration: 1440 }).catch(() => null);
  await updateChatState(guild.id, (data) => {
    data.question = { day: dayKey(now), messageId: message.id, threadId: thread?.id ?? null, channelId: channel.id };
    data.recentQuestions = [...(data.recentQuestions ?? []), index].slice(-40);
  });
  return { index, winner };
}

async function tickQuestion(guild, settings, now, random) {
  if (!settings.question.enabled || warsawHour(now) < settings.question.hour) return false;
  const state = await getChatState(guild.id);
  if (state.question?.day === dayKey(now)) return false;
  return Boolean(await postQuestion(guild, settings, { now, random }));
}

// ---------------------------------------------------------------- happy hour

/** Start and end (UTC ms) of today's happy hour. */
export function happyHourWindow(settings, now = Date.now()) {
  const start = midnightOf(dayKey(now)) + settings.happyHour.hour * 3_600_000;
  return { start, end: start + settings.happyHour.minutes * 60_000 };
}

async function tickHappyHour(guild, settings, now) {
  const { start, end } = happyHourWindow(settings, now);
  const running = settings.happyHour.enabled && settings.channelId && now >= start && now < end;
  const state = await getChatState(guild.id);
  if (running) {
    setHappyHour(guild.id, settings.happyHour.percent);
    if (state.happyHour?.day === dayKey(now)) return;
    const channel = guild.channels.cache.get(settings.channelId);
    const message = await channel?.send?.({
      embeds: [createEmbed({
        title: t`⚡ Happy hour: x${settings.happyHour.percent / 100} XP`,
        description: t`Until <t:${Math.floor(end / 1000)}:t> every message on the server gives **x${settings.happyHour.percent / 100} XP**. Chat away!`,
        color: '#FF9F0A',
        footer: false,
      })],
    }).catch(() => null);
    await updateChatState(guild.id, (data) => { data.happyHour = { day: dayKey(now), messageId: message?.id ?? null, channelId: channel?.id ?? null }; });
    return;
  }
  setHappyHour(guild.id, 100);
  if (state.happyHour?.messageId) {
    const channel = guild.channels.cache.get(state.happyHour.channelId);
    await channel?.messages?.delete?.(state.happyHour.messageId).catch(() => {});
    await updateChatState(guild.id, (data) => { data.happyHour = { ...data.happyHour, messageId: null }; });
  }
}

// ---------------------------------------------------------------- job

export async function tickChatEngagement(guild, now = Date.now(), random = Math.random) {
  const settings = await getChatSettings(guild.id);
  await tickHappyHour(guild, settings, now);
  if (!settings.channelId) return;
  await tickDrops(guild, settings, now, random);
  await tickDeadChat(guild, settings, now, random);
  await tickQuestion(guild, settings, now, random);
}

export async function runChatEngagement(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(guild.id));
      await tickChatEngagement(guild);
    } catch (error) {
      logger.warn(`Chat engagement failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
