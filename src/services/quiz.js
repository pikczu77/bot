// quiz.js — quiz questions on a channel with a money prize (2026-10-26, owner picked idea 13).
//
// A question has four answer buttons. Every member gets one try; the first right answer wins
// `reward` (times the server multiplier, Fortune and a "kasa" event). Nobody right within
// QUESTION_MS: the right answer is shown. One question at a time per server.
// Admins post one with /quiz pytanie; with `auto` on, the bot posts one every `everyMinutes`,
// but only when someone wrote on the channel since the last question (no talking to an empty room).
//
// Store guild:{id}:quiz = { channelId, auto, everyMinutes, reward, recent: [question indexes], lastPostAt }.
// The running question lives in memory; after a restart its buttons say it is over.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { QUIZ_QUESTIONS } from '../config/quizQuestions.js';
import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { enterLocale, t } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { withEconomyLock } from './economyUpgrades.js';
import { progressEmbeds, recordProgress } from './progress.js';
import { addSeasonReward, noteSeasonGifts, seasonGiftText } from './seasonalEvents.js';

export const QUESTION_MS = 45_000;
const RECENT_LIMIT = 60;
const LETTERS = ['A', 'B', 'C', 'D'];

const store = guildStore('quiz', { channelId: null, auto: false, everyMinutes: 60, reward: 1500, recent: [], lastPostAt: 0 });
export const getQuizSettings = (guildId) => store.get(guildId);
export const updateQuizSettings = (guildId, mutate) => store.update(guildId, mutate);

const running = new Map(); // guildId -> { id, channelId, messageId, index, order, correct, tried: Set, endsAt, timer, reward }
const lastTalk = new Map(); // channelId -> time of the last message from a member

/** featureMessages.js: a member wrote somewhere; the automatic quiz waits for that. */
export function noteQuizActivity(message) {
  if (lastTalk.size > 5000) lastTalk.clear();
  lastTalk.set(message.channelId, message.createdTimestamp ?? Date.now());
}

export const runningQuestion = (guildId) => running.get(guildId) ?? null;

function shuffle(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/** A question not asked lately. */
export function pickQuestion(recent = [], random = Math.random) {
  const fresh = QUIZ_QUESTIONS.map((_, index) => index).filter((index) => !recent.includes(index));
  const pool = fresh.length ? fresh : QUIZ_QUESTIONS.map((_, index) => index);
  return pool[Math.floor(random() * pool.length)];
}

function questionButtons(question, { disabled = false, reveal = false } = {}) {
  return [new ActionRowBuilder().addComponents(question.order.map((answer, position) => new ButtonBuilder()
    .setCustomId(`quiz:${question.id}:${position}`)
    .setLabel(`${LETTERS[position]}) ${answer}`.slice(0, 80))
    .setStyle(reveal && position === question.correct ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(disabled)))];
}

function questionEmbed(guildId, question, { footer = '', color = '#5865F2', extra = '' } = {}) {
  return createEmbed({
    title: t`🧠 Quiz · ${money(guildId, question.reward)} for the first right answer`,
    description: `**${QUIZ_QUESTIONS[question.index].q}**${extra ? `\n\n${extra}` : ''}`,
    color,
    footer: false,
  }).setFooter({ text: footer || t`One try per person · ends in ${Math.round(QUESTION_MS / 1000)} s` });
}

/** Post a question on `channel`. Returns the running question, or null when one is still running. */
export async function postQuestion(guild, channel, { now = Date.now(), random = Math.random } = {}) {
  if (running.has(guild.id)) return null;
  const settings = await getQuizSettings(guild.id);
  const economy = await getEconomySettings(guild.id);
  const index = pickQuestion(settings.recent, random);
  const data = QUIZ_QUESTIONS[index];
  const order = shuffle(data.a, random);
  const question = {
    id: now.toString(36),
    guildId: guild.id,
    channelId: channel.id,
    index,
    order,
    correct: order.indexOf(data.a[0]),
    tried: new Set(),
    reward: scaleEarnings(economy, settings.reward),
    endsAt: now + QUESTION_MS,
  };
  running.set(guild.id, question);
  try {
    const message = await channel.send({ embeds: [questionEmbed(guild.id, question)], components: questionButtons(question) });
    question.messageId = message.id;
    question.message = message;
  } catch (error) {
    running.delete(guild.id);
    throw error;
  }
  await updateQuizSettings(guild.id, (stored) => {
    stored.recent = [...(stored.recent ?? []), index].slice(-RECENT_LIMIT);
    stored.lastPostAt = now;
  });
  question.timer = setTimeout(() => expireQuestion(guild.id, question.id).catch((error) => logger.warn(`Quiz end failed: ${error.message}`)), QUESTION_MS);
  question.timer.unref?.();
  return question;
}

/** Time is up: show the right answer. */
export async function expireQuestion(guildId, questionId) {
  const question = running.get(guildId);
  if (!question || question.id !== questionId) return false;
  running.delete(guildId);
  clearTimeout(question.timer);
  const right = `${LETTERS[question.correct]}) ${question.order[question.correct]}`;
  await question.message?.edit({
    embeds: [questionEmbed(guildId, question, { color: '#8E8E93', extra: t`⏰ Time is up. The right answer: **${right}**`, footer: t('Nobody got it.') })],
    components: questionButtons(question, { disabled: true, reveal: true }),
  }).catch((error) => logger.warn(`Quiz message not edited: ${error.message}`));
  return true;
}

/**
 * A click on answer `position`. Returns { reply } (private answer) or { update } (new message payload).
 */
export async function answerQuestion({ client, guild, user, questionId, position }) {
  const question = running.get(guild.id);
  if (!question || question.id !== questionId) return { reply: t('This question is over. Wait for the next one!') };
  if (question.tried.has(user.id)) return { reply: t('You already answered this one.') };
  question.tried.add(user.id);
  if (Number(position) !== question.correct) return { reply: t('❌ Wrong answer. Maybe next time!') };

  running.delete(guild.id);
  clearTimeout(question.timer);
  const progress = await withEconomyLock(guild.id, user.id, async () => {
    const settings = await getEconomySettings(guild.id);
    const userData = await getEconomyData(client, guild.id, user.id);
    const quiz = await getQuizSettings(guild.id);
    const prize = scaleEarnings(settings, quiz.reward, userData);
    question.paid = prize;
    userData.wallet = (Number(userData.wallet) || 0) + prize;
    const result = recordProgress(userData, { quiz: 1 }, { settings });
    // Holiday events: a won question also gives the event currency (services/seasonalEvents.js).
    question.gifts = await addSeasonReward(guild.id, userData, 'game');
    await setEconomyData(client, guild.id, user.id, userData);
    await noteSeasonGifts(guild.id, user.id, question.gifts);
    return result;
  });
  const right = `${LETTERS[question.correct]}) ${question.order[question.correct]}`;
  const gifts = question.gifts?.length ? ` · ${seasonGiftText(question.gifts)}` : '';
  return {
    update: {
      embeds: [
        questionEmbed(guild.id, question, {
          color: '#30D158',
          extra: t`✅ **${user.username}** was first: **${right}** · **+${money(guild.id, question.paid)}**` + gifts,
          footer: t`Answers: ${question.tried.size}`,
        }),
        ...progressEmbeds(progress, guild.id),
      ],
      components: questionButtons(question, { disabled: true, reveal: true }),
    },
  };
}

/** Every minute: the automatic quiz posts when it is time and someone talked since the last question. */
export async function tickQuiz(guild, now = Date.now()) {
  const settings = await getQuizSettings(guild.id);
  if (!settings.auto || !settings.channelId || running.has(guild.id)) return false;
  if (now - (settings.lastPostAt || 0) < settings.everyMinutes * 60_000) return false;
  if (!((lastTalk.get(settings.channelId) || 0) > (settings.lastPostAt || 0))) return false;
  const channel = guild.channels.cache.get(settings.channelId);
  if (!channel?.send) return false;
  await postQuestion(guild, channel, { now });
  return true;
}

export async function runQuiz(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(guild.id));
      await tickQuiz(guild);
    } catch (error) {
      logger.warn(`Quiz failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
