// Keeping the chat alive (2026-10-26): drops, the Dead Chat ping after 30 quiet minutes, the question of the day
// with a prize for the most liked answer, the happy hour with x2 XP.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockRole, mockUser, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { getEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import {
  chatLive, getChatState, handleChatMessage, happyHourWindow, postDrop, tickChatEngagement, updateChatSettings,
} from '../src/services/chatEngagement.js';
import { happyHourFactor } from '../src/services/happyHourState.js';
import { applyXpMultipliers } from '../src/services/leveling/leveling.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let chat;
let deadRole;

// 26 Oct 2026 is a Monday; Warsaw = UTC+1.
const at = (hour, minute = 0) => Date.UTC(2026, 9, 26, hour - 1, minute);

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client, 'Czat');
  guild.client = client;
  chat = mockChannel(guild, 'chat');
  const sendMessage = chat.send;
  chat.send = async (payload) => {
    const message = await sendMessage(payload);
    message.edits = [];
    message.edit = async (next) => { message.edits.push(next); };
    message.startThread = async ({ name }) => {
      const thread = mockChannel(guild, name);
      thread.messages.fetch = async () => thread.answers ?? new Collection();
      message.thread = thread;
      return thread;
    };
    return message;
  };
  deadRole = mockRole(guild, 'Dead Chat');
  await updateEconomySettings(guild.id, (settings) => { settings.currency = { symbol: '$', position: 'left', separator: ',' }; });
  await updateChatSettings(guild.id, (settings) => { settings.channelId = chat.id; });
});

function say(member, content, now) {
  return handleChatMessage({
    guild, client, member, author: member.user, channel: chat, channelId: chat.id, content, createdTimestamp: now,
    react: async () => {},
  });
}

test('drops: only into a lively chat; the first to type the word gets the money; nobody = the drop expires', async () => {
  // Only drops here: the other parts would react to the test's jumps in time.
  await updateChatSettings(guild.id, (settings) => { settings.deadChat = { enabled: false }; settings.question = { enabled: false }; settings.happyHour = { enabled: false }; });
  const ola = mockMember(guild, mockUser('Ola'));
  const now = at(12);
  await tickChatEngagement(guild, now, () => 0);
  const sentBefore = chat.sent.length;
  await tickChatEngagement(guild, now + 25 * 60_000, () => 0);
  assert.equal(chat.sent.length, sentBefore, 'no messages yet: no drop');

  for (let index = 0; index < 15; index += 1) await say(ola, `wiadomość ${index}`, now + 24 * 60_000);
  await runWithLocale('en', () => tickChatEngagement(guild, now + 25 * 60_000, () => 0));
  const dropMessage = chat.sent.at(-1);
  assert.match(dropMessage.embeds[0].toJSON().description, /The first to type \*\*łap\*\* gets \*\*\$500\*\*/);

  const kuba = mockMember(guild, mockUser('Kuba'));
  assert.equal(await say(kuba, 'lap', now + 25 * 60_000), false, 'the word must be exact');
  assert.equal(await runWithLocale('en', () => say(kuba, ' ŁAP! ', now + 25 * 60_000 + 1000)), true);
  assert.equal((await getEconomyData(client, guild.id, kuba.id)).wallet, 500);
  assert.match(dropMessage.edits[0].embeds[0].toJSON().description, /fastest and gets \*\*\$500\*\*/);
  assert.equal(await say(ola, 'łap', now + 25 * 60_000 + 2000), false, 'only the first one');

  await runWithLocale('en', () => postDrop(guild, { channelId: chat.id, drops: { reward: 500, minMinutes: 20, maxMinutes: 60 } }, { now: Date.now(), random: () => 0 }));
  const unclaimed = chat.sent.at(-1);
  await runWithLocale('en', () => tickChatEngagement(guild, Date.now() + 61_000, () => 0.99));
  assert.match(unclaimed.edits[0].embeds[0].toJSON().description, /Nobody typed/);
});

test('Dead Chat: a ping with a topic after 30 quiet minutes in the daytime, once until someone talks again', async () => {
  const member = mockMember(guild, mockUser('Gaduła'));
  await updateChatSettings(guild.id, (settings) => { settings.drops = { enabled: false }; settings.deadChat = { enabled: true }; settings.question = { enabled: false }; settings.happyHour = { enabled: false }; });
  const start = at(14);
  await say(member, 'hej', start);
  let before = chat.sent.length;
  await tickChatEngagement(guild, start + 29 * 60_000);
  assert.equal(chat.sent.length, before, '29 minutes: not yet');
  await runWithLocale('en', () => tickChatEngagement(guild, start + 30 * 60_000));
  assert.equal(chat.sent.length, before + 1);
  assert.equal(chat.sent.at(-1).content, `<@&${deadRole.id}>`, 'the role named "Dead Chat" is found by itself');
  assert.match(chat.sent.at(-1).embeds[0].toJSON().title, /fell asleep/);
  await tickChatEngagement(guild, start + 70 * 60_000);
  assert.equal(chat.sent.length, before + 1, 'one ping until someone writes');

  await say(member, 'jestem', start + 80 * 60_000);
  before = chat.sent.length;
  await tickChatEngagement(guild, start + 111 * 60_000);
  assert.equal(chat.sent.length, before + 1, 'quiet again, more than an hour after the last ping');

  const night = Date.UTC(2026, 9, 26, 23, 30); // 00:30 in Warsaw
  await say(member, 'dobranoc', night - 40 * 60_000);
  before = chat.sent.length;
  await tickChatEngagement(guild, night);
  assert.equal(chat.sent.length, before, 'no pings at night');
  assert.ok(chatLive(guild.id));
});

test('question of the day at 18:00 with a thread; the next day the most liked answer wins', async () => {
  await updateChatSettings(guild.id, (settings) => { settings.question = { enabled: true, hour: 18, reward: 2000 }; settings.deadChat = { enabled: false }; });
  const before = chat.sent.length;
  await runWithLocale('en', () => tickChatEngagement(guild, at(17, 59)));
  assert.equal(chat.sent.length, before);
  await runWithLocale('en', () => tickChatEngagement(guild, at(18, 0)));
  const question = chat.sent.at(-1);
  assert.match(question.embeds[0].toJSON().title, /Question of the day/);
  assert.ok(question.thread);
  await runWithLocale('en', () => tickChatEngagement(guild, at(18, 1)));
  assert.equal(chat.sent.length, before + 1, 'once a day');

  const fan = mockMember(guild, mockUser('Fan'));
  const other = mockMember(guild, mockUser('Inny'));
  const answer = (member, count, ts) => ({ id: snowflake(), author: member.user, createdTimestamp: ts, reactions: { cache: new Collection([['❤️', { count, me: false }]]) } });
  question.thread.answers = new Collection([['1', answer(other, 2, 1)], ['2', answer(fan, 5, 2)]]);
  guild.channels.cache.set(question.thread.id, question.thread);

  const tomorrow = at(18) + 86_400_000;
  await runWithLocale('en', () => tickChatEngagement(guild, tomorrow));
  const next = chat.sent.at(-1);
  assert.equal(next.content, `<@${fan.id}>`);
  assert.match(next.embeds[0].toJSON().description, /best answer: <@\d+> \(5 reactions\) gets \*\*\$2,000\*\*/);
  assert.equal((await getEconomyData(client, guild.id, fan.id)).wallet, 2000);
  assert.equal((await getChatState(guild.id)).question.day, '2026-10-27');
});

test('happy hour: x2 XP for messages from 20:00 to 21:00, the announcement is deleted at the end', async () => {
  await updateChatSettings(guild.id, (settings) => { settings.question = { enabled: false }; settings.happyHour = { enabled: true, hour: 20, minutes: 60, percent: 200 }; });
  const { start, end } = happyHourWindow({ happyHour: { hour: 20, minutes: 60 } }, at(12));
  assert.equal(new Date(start).toISOString(), '2026-10-26T19:00:00.000Z');
  assert.equal(end - start, 3_600_000);

  await tickChatEngagement(guild, at(19, 59));
  assert.equal(happyHourFactor(guild.id), 1);
  await runWithLocale('en', () => tickChatEngagement(guild, at(20, 0)));
  assert.equal(happyHourFactor(guild.id), 2);
  const announcement = chat.sent.at(-1);
  assert.match(announcement.embeds[0].toJSON().title, /Happy hour: x2 XP/);
  const member = mockMember(guild, mockUser('Pisarz'));
  assert.equal(applyXpMultipliers({ xpMultiplier: 1 }, 20, { member, channel: chat, message: { content: 'hej', attachments: new Collection() } }), 40);
  assert.equal(applyXpMultipliers({ xpMultiplier: 1 }, 20, { member, channel: chat }), 20, 'voice XP is not doubled');

  await tickChatEngagement(guild, at(20, 30));
  assert.equal(chat.sent.filter((message) => /Happy hour/.test(message.embeds?.[0]?.toJSON?.().title ?? '')).length, 1, 'announced once');
  const deleted = [];
  chat.messages.delete = async (id) => { deleted.push(id); };
  await tickChatEngagement(guild, at(21, 0));
  assert.equal(happyHourFactor(guild.id), 1);
  assert.deepEqual(deleted, [announcement.id]);
});

test('panel: chat channel and the four parts, drop now; the Dead Chat role is found by its name', async () => {
  process.env.PANEL_API_KEY = 'test-panel-key-0123456789abcdef';
  const express = (await import('express')).default;
  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: 'Bearer test-panel-key-0123456789abcdef', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  };
  try {
    const view = (await call('GET', `/guilds/${guild.id}`)).json.modules.chat;
    assert.equal(view.channelId, chat.id);
    assert.equal(view.deadChat.minutes, 30);
    assert.equal(view.deadChatRoleFound, deadRole.id);
    const saved = await call('PATCH', `/guilds/${guild.id}/chat`, { deadChat: { minutes: 45, fromHour: 10 }, drops: { reward: 800 }, happyHour: { hour: 21 } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.deadChat.minutes, 45);
    assert.equal(saved.json.deadChat.fromHour, 10);
    assert.equal(saved.json.drops.reward, 800);
    assert.equal(saved.json.happyHour.hour, 21);
    const before = chat.sent.length;
    assert.equal((await call('PATCH', `/guilds/${guild.id}/chat`, { dropNow: true })).status, 200);
    assert.equal(chat.sent.length, before + 1);
    assert.equal((await call('PATCH', `/guilds/${guild.id}/chat`, { drops: { minMinutes: 90, maxMinutes: 30 } })).status, 400);
    assert.equal((await call('PATCH', `/guilds/${guild.id}/chat`, { happyHour: { percent: 1000 } })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
