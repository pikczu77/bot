// Quiz (2026-10-26): four answer buttons, one try per member, the first right answer wins money,
// the right answer is shown when time is up, automatic questions only after someone talked.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import { QUIZ_QUESTIONS } from '../src/config/quizQuestions.js';
import { expireQuestion, noteQuizActivity, pickQuestion, runningQuestion, tickQuiz, updateQuizSettings } from '../src/services/quiz.js';
import quizButton from '../src/interactions/buttons/fun/quiz.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Quiz');
  channel = mockChannel(guild, 'quiz');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
  });
});

const admin = () => mockMember(guild, mockUser('Szef'), { permissions: ['Administrator', 'ManageGuild'] });

async function quiz(member, sub, options = {}) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'quiz', subcommand: sub, options });
  await runWithLocale('en', () => client.commands.get('quiz').execute(interaction, {}, client));
  return interaction.replies.at(-1);
}

async function click(member, customId, message) {
  const calls = { reply: [], update: [] };
  const interaction = {
    id: snowflake(), client, guild, guildId: guild.id, channel, member, user: member.user, customId, message,
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
  };
  await runWithLocale('en', () => quizButton.execute(interaction, client, customId.split(':').slice(1)));
  return calls;
}

test('questions: four different answers each, the first one is right', () => {
  assert.ok(QUIZ_QUESTIONS.length >= 100);
  for (const question of QUIZ_QUESTIONS) {
    assert.equal(question.a.length, 4, question.q);
    assert.equal(new Set(question.a).size, 4, question.q);
    assert.ok(question.a.every((answer) => answer.length <= 70), question.q);
  }
  const recent = QUIZ_QUESTIONS.map((_, index) => index).filter((index) => index !== 5);
  assert.equal(pickQuestion(recent, () => 0.5), 5, 'questions asked lately are skipped');
});

test('/quiz pytanie: wrong answers privately, one try each, the first right answer wins', async () => {
  await updateQuizSettings(guild.id, (settings) => { settings.reward = 2000; settings.channelId = null; });
  const reply = await quiz(admin(), 'pytanie');
  assert.match(replyText({ replies: [reply] }), /Question posted/);
  const message = channel.sent.at(-1);
  const question = runningQuestion(guild.id);
  assert.ok(question);
  const buttons = message.components[0].toJSON().components;
  assert.equal(buttons.length, 4);
  assert.match(message.embeds[0].toJSON().title, /\$2,000/);
  assert.match(message.embeds[0].toJSON().description, new RegExp(QUIZ_QUESTIONS[question.index].q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const wrongId = buttons[(question.correct + 1) % 4].custom_id;
  const rightId = buttons[question.correct].custom_id;
  const ola = mockMember(guild, mockUser('Ola'));
  const kuba = mockMember(guild, mockUser('Kuba'));
  assert.match((await click(ola, wrongId)).reply[0].content, /Wrong answer/);
  assert.match((await click(ola, rightId)).reply[0].content, /already answered/);
  const second = await quiz(admin(), 'pytanie').catch((error) => error);
  assert.match(String(second?.userMessage ?? replyText({ replies: [second] })), /still running/);

  const win = await click(kuba, rightId);
  const text = replyText({ replies: win.update });
  assert.match(text, /Kuba\*\* was first/);
  assert.match(text, /\+\$2,000/);
  assert.equal((await getEconomyData(client, guild.id, kuba.id)).wallet, 2000);
  assert.equal(runningQuestion(guild.id), null);
  assert.match((await click(ola, rightId)).reply[0].content, /over/);
});

test('time is up: the right answer is shown and nobody is paid', async () => {
  await quiz(admin(), 'pytanie');
  const question = runningQuestion(guild.id);
  const edits = [];
  question.message.edit = async (payload) => { edits.push(payload); };
  assert.equal(await expireQuestion(guild.id, question.id), true);
  assert.match(edits[0].embeds[0].toJSON().description, /Time is up/);
  assert.equal(runningQuestion(guild.id), null);
});

test('automatic questions: on the set channel, only after someone talked since the last one', async () => {
  const room = mockChannel(guild, 'pogaduchy');
  const now = Date.UTC(2026, 9, 26, 15, 0);
  await updateQuizSettings(guild.id, (settings) => Object.assign(settings, { channelId: room.id, auto: true, everyMinutes: 30, lastPostAt: now - 60 * 60_000 }));
  assert.equal(await tickQuiz(guild, now), false, 'nobody talked');
  noteQuizActivity({ channelId: room.id, createdTimestamp: now - 1000 });
  assert.equal(await tickQuiz(guild, now), true);
  assert.equal(room.sent.length, 1);
  await expireQuestion(guild.id, runningQuestion(guild.id).id);
  noteQuizActivity({ channelId: room.id, createdTimestamp: now + 60_000 });
  assert.equal(await tickQuiz(guild, now + 10 * 60_000), false, 'too soon');
  assert.equal(await tickQuiz(guild, now + 31 * 60_000), true);
  await expireQuestion(guild.id, runningQuestion(guild.id).id);

  await updateQuizSettings(guild.id, (settings) => Object.assign(settings, { reward: 500, auto: false }));
  const status = await quiz(admin(), 'pytanie');
  assert.match(replyText({ replies: [status] }), /Automatic questions: off/);
  assert.match(replyText({ replies: [status] }), /\$500/);
  await expireQuestion(guild.id, runningQuestion(guild.id).id);
});
