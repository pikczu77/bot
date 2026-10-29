// chatEngagement.js — things that get people writing on the main chat (2026-10-26, owner picked from my list
// "1,2,3,5 - zrob i ja chce zeby deadchat byl po 30 minutach bez gadania").
//
//   drops      while the chat is lively, now and then: "the first to type <word> gets money"
//   deadChat   after `minutes` (30) without a message in the daytime: ping the Dead Chat role with a topic
//   question   every day at `hour`: a short question; the first right reply to it wins `reward` (one answer per
//              person); after `minutes` without a right answer the answer is shown
//   happyHour  every day from `hour` for `minutes`: messages give more XP (services/happyHourState.js), with an
//              announcement on the chat that is deleted at the end
//   announce   every day at `hour` (2026-10-27, owner: "ogloszenia ze dostepne jest wordle i daily questy"): the new
//              Wordle, the new missions, /daily, the question time and the lottery on Sunday; yesterday's one is deleted.
//              On `announce.channelId`, or the chat channel when none is picked.
// All of it works on one chat channel (`channelId`). Checked every minute (features.js); messages are seen through
// handleChatMessage() in featureMessages.js (members only, bots do not count).
//
// Store guild:{id}:chat-engagement = { channelId, drops, deadChat, question, happyHour, announce } and
// guild:{id}:chat-engagement-state = { question: { day, index, messageId, channelId, closesAt, tried, answered, closed, winnerId },
// happyHour: { day, messageId, channelId }, announce: { day, messageId, channelId }, lastDeadPingAt }.

import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { enterLocale, t } from '../i18n/index.js';
import { dayKey, midnightOf, warsawHour } from '../utils/warsawTime.js';
import { DAILY_TRIVIA, DEAD_CHAT_TOPICS, DROP_WORDS } from '../config/chatPrompts.js';
import { getGuildLocale } from './languageService.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { withEconomyLock } from './economyUpgrades.js';
import { missionsEnabled, recordProgress } from './progress.js';
import { setHappyHour } from './happyHourState.js';
import { puzzleNumber } from './wordle.js';
import { DRAW_HOUR } from './lottery.js';
import { giveSeasonCurrency, seasonDropBonus } from './seasonalEvents.js';

export const CHAT_DEFAULTS = Object.freeze({
  channelId: null,
  drops: { enabled: true, minMinutes: 20, maxMinutes: 60, minMessages: 15, reward: 500 },
  deadChat: { enabled: true, minutes: 30, roleId: null, fromHour: 9, toHour: 23, minGapMinutes: 60 },
  question: { enabled: true, hour: 18, reward: 2000, minutes: 120 },
  happyHour: { enabled: true, hour: 20, minutes: 60, percent: 200 },
  announce: { enabled: true, hour: 10, channelId: null },
});
export const CHAT_PARTS = Object.freeze(['drops', 'deadChat', 'question', 'happyHour', 'announce']);
export const DROP_MS = 60_000;
const DEAD_ROLE_RE = /dead\s*-?\s*chat|martwy\s*czat/i;

const store = guildStore('chat-engagement', structuredClone(CHAT_DEFAULTS));
const stateStore = guildStore('chat-engagement-state', { question: null, happyHour: null, announce: null, lastDeadPingAt: 0 });

/** Settings with every part filled in (older stored settings miss new fields). */
export async function getChatSettings(guildId) {
  const stored = await store.get(guildId);
  const settings = structuredClone(CHAT_DEFAULTS);
  settings.channelId = stored.channelId ?? null;
  for (const part of CHAT_PARTS) Object.assign(settings[part], stored[part] ?? {});
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
  // Holiday events: a caught drop also gives the event currency (services/seasonalEvents.js).
  const caughtAt = message.createdTimestamp ?? Date.now();
  const bonus = [];
  for (const { event, amount } of await seasonDropBonus(guildId, caughtAt)) {
    bonus.push({ event, amount: await giveSeasonCurrency(event, message.client, guildId, message.author.id, amount, { now: caughtAt, kind: 'drop' }) });
  }
  message.react('🎉').catch(() => {});
  await drop.message?.edit({
    embeds: [createEmbed({
      title: t('🎁 Drop caught!'),
      description: t`${message.author} was the fastest and gets **${money(guildId, prize)}**.` + bonus.map(({ event, amount }) => t` And **${amount} ${event.currency}**!`).join(''),
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
  if (message.reference?.messageId && await answerQuestion(message, settings, sentAt)) return true;
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
// Owner on 2026-10-26: "to ma byc odpowiedz i kto szybciej odpowie w odpowiedzi do wiadomosci ... wygrywa, jedna
// odpowiedz". A short question (a word or a number); members answer by replying to the bot's message; one answer
// per person; the first right one wins `reward`. Nobody right within `minutes`: the answer is shown.

/** "Wisła!" -> "wisla": lower case, no Polish letters, no punctuation. */
export const foldAnswer = (text) => String(text ?? '').toLocaleLowerCase('pl').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();

export const isRightAnswer = (text, trivia) => trivia.a.some((answer) => foldAnswer(answer) === foldAnswer(text));

// A question saved before 23e93b5 (thread + reactions) has no `index`: it is only marked closed, nothing to reveal.
const knownQuestion = (question) => Boolean(question && Number.isInteger(question.index) && DAILY_TRIVIA[question.index]);

const questionLocks = new Map();
// One answer at a time per server, so two quick right answers cannot both win.
function withQuestionLock(guildId, task) {
  const previous = questionLocks.get(guildId) ?? Promise.resolve();
  const next = previous.then(task, task);
  questionLocks.set(guildId, next.catch(() => {}));
  return next;
}

async function questionMessage(guild, question) {
  const cached = liveOf(guild.id).questionMessage;
  if (cached?.id === question.messageId) return cached;
  const channel = guild.channels.cache.get(question.channelId);
  return channel?.messages?.fetch?.(question.messageId).catch(() => null) ?? null;
}

function questionEmbed(guild, question, settings, { note = '', color = '#BF5AF2', solved = false } = {}) {
  const trivia = DAILY_TRIVIA[question.index];
  return createEmbed({
    title: solved ? t('❓ Question of the day - solved') : t('❓ Question of the day'),
    description: [`**${trivia.q}**`, note].filter(Boolean).join('\n\n'),
    color,
    footer: false,
  });
}

/** A reply to the question: true when it was one (handled here). */
async function answerQuestion(message, settings, sentAt) {
  const guild = message.guild;
  return withQuestionLock(guild.id, async () => {
    const state = await getChatState(guild.id);
    const question = state.question;
    if (!knownQuestion(question) || question.messageId !== message.reference?.messageId) return false;
    if (question.answered || question.closed || sentAt > question.closesAt) return false;
    if ((question.tried ?? []).includes(message.author.id)) {
      message.react('⛔').catch(() => {});
      return true;
    }
    const right = isRightAnswer(message.content, DAILY_TRIVIA[question.index]);
    await updateChatState(guild.id, (data) => {
      data.question.tried = [...(data.question.tried ?? []), message.author.id];
      if (right) Object.assign(data.question, { answered: true, winnerId: message.author.id });
    });
    if (!right) {
      message.react('❌').catch(() => {});
      return true;
    }
    const economy = await getEconomySettings(guild.id);
    const prize = await withEconomyLock(guild.id, message.author.id, async () => {
      const userData = await getEconomyData(message.client, guild.id, message.author.id);
      const amount = scaleEarnings(economy, settings.question.reward, userData);
      userData.wallet = (Number(userData.wallet) || 0) + amount;
      recordProgress(userData, { questionWin: 1 }, { settings: economy });
      await setEconomyData(message.client, guild.id, message.author.id, userData);
      return amount;
    });
    message.react('✅').catch(() => {});
    const original = await questionMessage(guild, question);
    await original?.edit({
      embeds: [questionEmbed(guild, question, settings, {
        solved: true,
        color: '#30D158',
        note: t`✅ ${message.author} answered first: **${message.content.trim().slice(0, 100)}** · **+${money(guild.id, prize)}**`,
      })],
    }).catch(() => {});
    return true;
  });
}

export async function postQuestion(guild, settings, { now = Date.now(), random = Math.random } = {}) {
  const channel = guild.channels.cache.get(settings.channelId);
  if (!channel?.send) return null;
  const state = await getChatState(guild.id);
  await closeQuestion(guild, settings, state, now);
  const used = new Set(state.recentQuestions ?? []);
  const fresh = DAILY_TRIVIA.map((_, index) => index).filter((index) => !used.has(index));
  const index = pick(fresh.length ? fresh : DAILY_TRIVIA.map((_, i) => i), random);
  const economy = await getEconomySettings(guild.id);
  const closesAt = now + settings.question.minutes * 60_000;
  const question = { index };
  const message = await channel.send({
    embeds: [questionEmbed(guild, question, settings, {
      note: t`**Reply to this message** with your answer (a word or a number). One answer per person, the first right one gets **${money(guild.id, scaleEarnings(economy, settings.question.reward))}**.\n-# Until <t:${Math.floor(closesAt / 1000)}:t>`,
    })],
  }).catch((error) => { logger.warn(`Question of the day not posted in guild ${guild.id}: ${error.message}`); return null; });
  if (!message) return null;
  liveOf(guild.id, now).questionMessage = message;
  await updateChatState(guild.id, (data) => {
    data.question = { day: dayKey(now), index, messageId: message.id, channelId: channel.id, closesAt, tried: [], answered: false, closed: false, winnerId: null };
    data.recentQuestions = [...(data.recentQuestions ?? []), index].slice(-40);
  });
  return { index };
}

/** Nobody answered right in time: show the answer. */
async function closeQuestion(guild, settings, state, now) {
  const question = state.question;
  if (!question || question.answered || question.closed) return false;
  if (!knownQuestion(question)) {
    await updateChatState(guild.id, (data) => { data.question.closed = true; });
    return false;
  }
  if (now < question.closesAt) return false;
  await updateChatState(guild.id, (data) => { data.question.closed = true; });
  const original = await questionMessage(guild, question);
  await original?.edit({
    embeds: [questionEmbed(guild, question, settings, {
      color: '#8E8E93',
      note: t`⏰ Time is up, nobody got it. The answer: **${DAILY_TRIVIA[question.index].a[0]}**`,
    })],
  }).catch(() => {});
  return true;
}

async function tickQuestion(guild, settings, now, random) {
  const state = await getChatState(guild.id);
  await closeQuestion(guild, settings, state, now);
  if (!settings.question.enabled || warsawHour(now) < settings.question.hour) return false;
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

// ---------------------------------------------------------------- daily announcement

/** The day's announcement embed: what is new today and what happens later. */
export async function announcementEmbed(guild, settings, now = Date.now()) {
  const day = dayKey(now);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday, 1 Monday
  const economy = await getEconomySettings(guild.id);
  const wordleReward = scaleEarnings(economy, economy.commands.wordle.reward);
  const lines = [
    t`🟩 **Wordle #${puzzleNumber(day)}** is ready: \`/wordle\`, up to **${money(guild.id, wordleReward)}**`,
    missionsEnabled(economy)
      ? (weekday === 1 ? t('🎯 **New daily and weekly missions**: `/misje`') : t('🎯 **New daily missions**: `/misje`'))
      : null,
    t('🎁 Collect your `/daily` and keep the streak going'),
    settings.question.enabled && settings.channelId
      ? t`❓ **Question of the day** at **${settings.question.hour}:00** on <#${settings.channelId}>`
      : null,
    weekday === 0 ? t`🎟️ **Lottery draw** today at **${DRAW_HOUR}:00**: \`/loteria\`` : null,
  ].filter(Boolean);
  return createEmbed({
    title: weekday === 1 ? t('☀️ A new week on the server') : t('☀️ A new day on the server'),
    description: lines.join('\n'),
    color: '#30D158',
    footer: false,
  });
}

/** Post today's announcement (also the panel's "announce now"); yesterday's one is deleted. Returns the message or null. */
export async function postAnnouncement(guild, settings, now = Date.now()) {
  const channelId = settings.announce.channelId || settings.channelId;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.send) return null;
  const message = await channel.send({ embeds: [await announcementEmbed(guild, settings, now)] })
    .catch((error) => { logger.warn(`Daily announcement not posted in guild ${guild.id}: ${error.message}`); return null; });
  const state = await getChatState(guild.id);
  const old = state.announce;
  if (message && old?.messageId && old.messageId !== message.id) {
    await guild.channels.cache.get(old.channelId)?.messages?.delete?.(old.messageId).catch(() => {});
  }
  await updateChatState(guild.id, (data) => {
    data.announce = { day: dayKey(now), messageId: message?.id ?? null, channelId: message ? channel.id : null };
  });
  return message;
}

async function tickAnnounce(guild, settings, now) {
  if (!settings.announce.enabled || warsawHour(now) < settings.announce.hour) return false;
  const state = await getChatState(guild.id);
  if (state.announce?.day === dayKey(now)) return false;
  return Boolean(await postAnnouncement(guild, settings, now));
}

// ---------------------------------------------------------------- job

export async function tickChatEngagement(guild, now = Date.now(), random = Math.random) {
  const settings = await getChatSettings(guild.id);
  await tickHappyHour(guild, settings, now);
  await tickAnnounce(guild, settings, now);
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
