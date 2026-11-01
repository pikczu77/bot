// 2026-11-01: Klubiś answers messages (services/klubis.js, taught answers in tagService, panel module "Klubiś").
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { KLUBIS_CALLED, KLUBIS_SKILLS, KLUBIS_STARTER, KLUBIS_UNKNOWN } from '../src/config/klubisReplies.js';
import { PRESET_ALLOWED_WORDS, PRESET_SLURS, PRESET_WORDS } from '../src/config/automodPresets.js';
import { findBannedWord, findSlur } from '../src/services/automodService.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { MEMBER_GAP_MS, callsKlubis, findSkill, fold, getKlubisSettings, handleKlubisMessage, saveKlubisSettings } from '../src/services/klubis.js';
import { handleTagMessage, setResponders } from '../src/services/tagService.js';

const KEY = 'test-panel-key-0123456789abcdef';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null, cache: new Collection() }, commands: new Collection() };
let server;
let base;
let clock = Date.UTC(2026, 10, 2, 12, 0, 0);
const tick = (ms) => { clock += ms; return clock; };

async function call(method, urlPath, body) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function setup(name) {
  const guild = mockGuild(client, name);
  const chat = mockChannel(guild, 'czat');
  const member = mockMember(guild, mockUser(`ola-${name}`));
  member.displayName = 'Ola';
  return { guild, chat, member };
}

/** A message; `replies` collects what Klubiś answered with message.reply. */
function message(guild, channel, member, content, { mentionBot = false, replyToBot = false } = {}) {
  const botId = client.user.id;
  const users = new Collection();
  if (mentionBot || replyToBot) users.set(botId, client.user);
  const msg = {
    guild, client, channel, channelId: channel.id, member, author: member.user, content,
    mentions: { users, roles: new Collection(), repliedUser: replyToBot ? client.user : null },
    replies: [],
  };
  msg.reply = async (payload) => { msg.replies.push(payload); return { id: '1' }; };
  return msg;
}

const say = async (msg, options = {}) => {
  await handleKlubisMessage(msg, { now: tick(MEMBER_GAP_MS + 1), ...options });
  return msg.replies[0] ?? null;
};
const lines = (id) => KLUBIS_SKILLS.find((skill) => skill.id === id).replies;
const filled = (list, name = 'Ola', server = '') => list.map((line) => line.replaceAll('{user}', name).replaceAll('{server}', server));

test('fold, the name and the skills', () => {
  assert.equal(fold('Siema KLUBIŚ, jak się masz?!'), 'siema klubis jak sie masz');
  assert.equal(fold('Żółć łąki'), 'zolc laki');
  assert.equal(fold('SIEMAAAA klubiśśś, seriooo?'), 'siema klubis serio');
  assert.equal(fold('xdddd'), 'xd');
  for (const text of ['klubiś', 'Klubisiu chodź', 'hej klubisie', 'dzięki klubisiowi', 'klubiku!']) {
    assert.equal(callsKlubis({ content: text, client }), true, text);
  }
  for (const text of ['Klubik Pikcza najlepszy', 'w klubie', 'klub', 'klubowicz']) {
    assert.equal(callsKlubis({ content: text, client }), false, text);
  }
  assert.equal(findSkill('jak sie masz').id, 'how');
  assert.equal(findSkill('kim jestes').id, 'who');
  assert.equal(findSkill('czy bedzie padac').id, 'question');
  assert.equal(findSkill('pogadamy', 'pogadamy?').id, 'question');
  assert.equal(findSkill('siema').id, 'hello');
  assert.equal(findSkill('kim jestes', '', { aloneOnly: true }), null);
  assert.equal(findSkill('dobranoc wszystkim', '', { aloneOnly: true }).id, 'night');
  for (const text of ['kiedy update', 'kiedy bedzie update', 'kiedy nowy update', 'kiedy wyjdzie aktualizacja', 'update kiedy']) {
    assert.equal(findSkill(text).id, 'update', text);
  }
  assert.equal(findSkill('kiedy update', 'kiedy update?').id, 'update', 'the question mark does not make it a yes/no question');
  assert.equal(findSkill('kiedy update', '', { aloneOnly: true }), null, 'only when Klubiś is called');
  assert.equal(findSkill('zrobilem update'), null);
  // Every line is clean text that fits in a message.
  for (const skill of KLUBIS_SKILLS) for (const line of skill.replies) assert.ok(line.length > 0 && line.length < 300, line);
});

test('called by a mention, a reply or the name: a skill answers, unknown text gets a "learning" line', async () => {
  const { guild, chat, member } = setup('Wolanie');
  const hello = await say(message(guild, chat, member, `<@${client.user.id}> siema`, { mentionBot: true }));
  assert.ok(filled(lines('hello'), 'Ola', guild.name).includes(hello.content), hello.content);
  assert.deepEqual(hello.allowedMentions, { parse: [], repliedUser: false });

  const how = await say(message(guild, chat, member, 'Klubiś, jak się masz?'));
  assert.ok(filled(lines('how')).includes(how.content), how.content);

  const yesNo = await say(message(guild, chat, member, 'a ty myślisz, że wygram?', { replyToBot: true }));
  assert.ok(filled(lines('question')).includes(yesNo.content), yesNo.content);

  const update = await say(message(guild, chat, member, `<@${client.user.id}> kiedy update`, { mentionBot: true }));
  assert.ok(filled(lines('update')).includes(update.content), update.content);

  const unknown = await say(message(guild, chat, member, 'klubiś banan traktor'));
  assert.ok(filled(KLUBIS_UNKNOWN).includes(unknown.content), unknown.content);

  const onlyName = await say(message(guild, chat, member, 'Klubiś'));
  assert.ok(filled(KLUBIS_CALLED).includes(onlyName.content), onlyName.content);
});

// What members really wrote on the server on 2026-11-01, and the skill that must answer it.
const LIVE_MESSAGES = [
  ['Co chcesz?', 'want'],
  ['Lubię grać w minecraft a ty?', 'minecraft'],
  ['Okej', 'ack'],
  ['Co seriooooooo bruh', 'serio'],
  ['jakie bity', 'bits'],
  ['Brat nie ogarnia', 'lost'],
  ['umiesz inaczej pisac?', 'can'],
  ['kiedy update', 'update'],
  ['jest regulamin?', 'rules'],
  ['rozumiesz conapisales?', 'lost'],
  ['dobrze', 'fine'],
];

test('what members wrote to Klubiś gets an answer that fits', () => {
  for (const [raw, id] of LIVE_MESSAGES) assert.equal(findSkill(fold(raw), raw)?.id, id, raw);
});

test('a question with a question word is never answered with yes or no', () => {
  const cases = [
    ['co to jest?', 'askWhat'], ['kto to zrobił?', 'askWho'], ['gdzie to jest?', 'askWhere'], ['kiedy to będzie?', 'askWhen'],
    ['czemu tak jest?', 'askWhy'], ['ile to kosztuje?', 'askHowMany'], ['jak to zrobić?', 'askHow'], ['jaki jest najlepszy?', 'askWhich'],
    ['a co ty na to?', 'askWhat'], ['brat kiedy to?', 'askWhen'],
  ];
  for (const [raw, id] of cases) assert.equal(findSkill(fold(raw), raw)?.id, id, raw);
  for (const raw of ['czy pada?', 'a czy pada', 'wygram?', 'nie wiem czy pada?']) assert.equal(findSkill(fold(raw), raw)?.id, 'question', raw);
});

test('skills that could get in each other\'s way', () => {
  const cases = [
    ['nie lubię cię', 'mean'], ['kocham cię', 'love'], ['jak masz na imię?', 'name'], ['ile masz lat?', 'age'], ['ile to 2+2', 'math'],
    ['minecraft czy roblox?', 'choice'], ['pizza czy burger', 'choice'], ['lubisz koty?', 'pets'], ['lubisz minecrafta?', 'minecraft'], ['lubisz banany?', 'like'],
    ['co myślisz o pikczu?', 'pikczu'], ['co myślisz o tym?', 'opinion'], ['powiedz coś miłego', 'compliment'], ['powiedz coś', 'facts'],
    ['opowiedz żart', 'joke'], ['opowiedz bajkę', 'story'], ['daj kasę', 'money'], ['daj admina', 'rank'], ['dobrze, a u ciebie?', 'fine'], ['a ty?', 'youToo'],
    ['xddddd', 'laugh'], ['hahaha', 'laugh'], ['nie', 'no'], ['no', 'yes'], ['siemaaaa', 'hello'], ['dzień dobry', 'morning'], ['oceń mnie', 'rate'],
    ['kot czy pies', 'choice'], ['jest jakiś event?', 'event'], ['będzie nowy film?', 'video'], ['jakie jest IP?', 'smp'], ['masz coś?', 'have'],
    ['jesteś tu?', 'youAre'], ['napiszesz coś?', 'doYou'], ['gram dzisiaj w lego', 'me'], ['kartkówka jutro', 'school'],
    ['nie chcę żyć', 'crisis'], ['chcę zabić creepera', 'minecraft'], ['zabiję się ze śmiechu', null],
  ];
  for (const [raw, id] of cases) assert.equal(findSkill(fold(raw), raw)?.id ?? null, id, raw);
});

test('the lines: enough of them, no repeats in a skill, real commands, nothing the server itself bans', async () => {
  const all = KLUBIS_SKILLS.flatMap((skill) => skill.replies);
  assert.ok(new Set(all).size + KLUBIS_UNKNOWN.length + KLUBIS_CALLED.length >= 700, `${new Set(all).size} lines`);
  for (const list of [...KLUBIS_SKILLS.map((skill) => skill.replies), KLUBIS_UNKNOWN, KLUBIS_CALLED]) {
    assert.equal(new Set(list).size, list.length, list[0]);
  }
  assert.equal(new Set(KLUBIS_SKILLS.map((skill) => skill.id)).size, KLUBIS_SKILLS.length);

  const loaded = { commands: new Collection(), guilds: { cache: new Collection() } };
  await loadCommands(loaded);
  const named = [...all, ...KLUBIS_UNKNOWN, ...KLUBIS_CALLED].flatMap((line) => [...line.matchAll(/(?:^|[\s`(])\/([a-z]+)/g)].map((match) => match[1]));
  assert.ok(named.length > 50);
  assert.deepEqual([...new Set(named)].filter((name) => !loaded.commands.has(name)), []);

  for (const line of [...all, ...KLUBIS_UNKNOWN, ...KLUBIS_CALLED]) {
    assert.equal(findBannedWord(line, PRESET_WORDS, PRESET_ALLOWED_WORDS), null, line);
    assert.equal(findSlur(line, PRESET_SLURS), null, line);
  }
});

test('one answer per member every few seconds; commands with the prefix are left alone', async () => {
  const { guild, chat, member } = setup('Przerwa');
  const first = message(guild, chat, member, 'klubiś co robisz');
  await handleKlubisMessage(first, { now: tick(60_000) });
  const second = message(guild, chat, member, 'klubiś co robisz');
  await handleKlubisMessage(second, { now: tick(1000) });
  assert.equal(first.replies.length, 1);
  assert.equal(second.replies.length, 0);
  assert.equal(await say(message(guild, chat, member, '!work klubiś')), null);
});

test('without a call: only short greetings and the like, with the chance and the break per channel and skill', async () => {
  const { guild, chat, member } = setup('Bez wolania');
  await saveKlubisSettings(guild.id, { chance: 100, cooldownMinutes: 3 });
  const night = await say(message(guild, chat, member, 'dobranoc'));
  assert.ok(filled(lines('night')).includes(night.content));
  assert.equal(await say(message(guild, chat, member, 'dobranoc wszystkim')), null, 'the break of this skill on the channel');
  assert.ok(await say(message(guild, chat, member, 'siema')), 'another skill has its own break');
  assert.equal(await say(message(guild, chat, member, 'hejka')), null);
  tick(3 * 60_000);
  assert.ok(await say(message(guild, chat, member, 'siema')));
  tick(3 * 60_000);
  assert.equal(await say(message(guild, chat, member, 'kim jesteś')), null, 'a called-only skill');
  assert.equal(await say(message(guild, chat, member, 'siema a ktoś wie jak zrobić farmę żelaza w wersji 1.21 bez villagerów')), null, 'a long message');
  assert.equal(await say(message(guild, chat, member, 'zbudowałem dom')), null);

  await saveKlubisSettings(guild.id, { chance: 0 });
  tick(10 * 60_000);
  assert.equal(await say(message(guild, chat, member, 'dobranoc')), null, 'chance 0');
  await saveKlubisSettings(guild.id, { chance: 100, phrases: false });
  assert.equal(await say(message(guild, chat, member, 'dobranoc')), null, 'phrases off');
  assert.ok(await say(message(guild, chat, member, 'dobranoc klubiś')), 'a call still works');
});

test('switched off, other channels and mentions off', async () => {
  const { guild, chat, member } = setup('Wylaczony');
  const other = mockChannel(guild, 'inny');
  await saveKlubisSettings(guild.id, { channels: [chat.id] });
  assert.ok(await say(message(guild, chat, member, 'klubiś hej')));
  assert.equal(await say(message(guild, other, member, 'klubiś hej')), null);
  const thread = mockChannel(guild, 'watek', { parentId: chat.id });
  assert.ok(await say(message(guild, thread, member, 'klubiś hej')), 'a thread of an allowed channel');
  await saveKlubisSettings(guild.id, { mentions: false, phrases: false });
  assert.equal(await say(message(guild, chat, member, 'klubiś hej')), null);
  await saveKlubisSettings(guild.id, { mentions: true, enabled: false });
  assert.equal(await say(message(guild, chat, member, 'klubiś hej')), null);
});

test('taught answers: one of several at random, behind the same switch and channels', async () => {
  const { guild, chat, member } = setup('Nauka');
  await setResponders(guild.id, [{ trigger: 'pikczu', mode: 'word', responses: ['Pikczu to szef 😎', 'Ktoś woła Pikczu?'] }]);
  const sent = chat.sent;
  const taught = message(guild, chat, member, 'gdzie jest pikczu');
  assert.equal(await handleTagMessage(taught, '!'), true);
  assert.ok(['Pikczu to szef 😎', 'Ktoś woła Pikczu?'].includes(sent.at(-1).content));
  assert.equal(await handleTagMessage(message(guild, chat, member, 'pikczuuu'), '!'), false, 'word mode');

  await saveKlubisSettings(guild.id, { enabled: false });
  const before = sent.length;
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(await handleTagMessage(message(guild, chat, member, 'pikczu?'), '!'), false);
  assert.equal(sent.length, before);
});

test('an old auto-responder with one `response` still answers', async () => {
  const { guild, chat, member } = setup('Stary');
  await setResponders(guild.id, [{ trigger: 'regulamin', mode: 'contains', response: 'Regulamin jest na #zasady' }]);
  assert.equal(await handleTagMessage(message(guild, chat, member, 'gdzie regulamin'), '!'), true);
  assert.equal(chat.sent.at(-1).content, 'Regulamin jest na #zasady');
});

test('panel: settings, taught answers, skills; bad values are refused', async () => {
  const { guild, chat } = setup('Panel');
  const read = await call('GET', `/guilds/${guild.id}`);
  const view = read.json.modules.klubis;
  assert.equal(view.enabled, true);
  assert.equal(view.mentions, true);
  assert.equal(view.chance, 30);
  assert.equal(view.responders.length, KLUBIS_STARTER.length, 'the answers about the server are there from the start');
  assert.deepEqual(view.responders[0], { trigger: 'jak zarobić', mode: 'contains', responses: KLUBIS_STARTER[0].responses });
  assert.ok(view.skills.some((skill) => skill.id === 'night' && skill.alone && skill.example === 'dobranoc'));
  assert.equal(view.limits.responders, 50);

  const saved = await call('PATCH', `/guilds/${guild.id}/klubis`, {
    enabled: true, mentions: true, phrases: false, chance: 50, cooldownMinutes: 10, channels: [chat.id],
    responders: [{ trigger: '  Ile Kosztuje  VIP ', mode: 'contains', responses: ['VIP kosztuje 10 zł', '  ', 'Zajrzyj na pikczu.pl/donate'] }],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.phrases, false);
  assert.equal(saved.json.chance, 50);
  assert.deepEqual(saved.json.channels, [chat.id]);
  assert.deepEqual(saved.json.responders, [{ trigger: 'ile kosztuje vip', mode: 'contains', responses: ['VIP kosztuje 10 zł', 'Zajrzyj na pikczu.pl/donate'] }]);
  assert.equal((await getKlubisSettings(guild.id)).cooldownMinutes, 10);

  for (const body of [
    { chance: 101 }, { cooldownMinutes: -1 }, { enabled: 'tak' }, { channels: ['1'] }, { channels: 'x' },
    { responders: [{ trigger: '', responses: ['a'] }] },
    { responders: [{ trigger: 'a', responses: [] }] },
    { responders: [{ trigger: 'a', mode: 'regex', responses: ['b'] }] },
    { responders: [{ trigger: 'a', responses: ['b'] }, { trigger: 'A', responses: ['c'] }] },
    { responders: [{ trigger: 'a', responses: ['x'.repeat(501)] }] },
    { responders: Array.from({ length: 51 }, (_, i) => ({ trigger: `t${i}`, responses: ['x'] })) },
  ]) {
    assert.equal((await call('PATCH', `/guilds/${guild.id}/klubis`, body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  // A refused save changes nothing.
  assert.equal((await getKlubisSettings(guild.id)).chance, 50);
});

test('answers about the server are added once, next to the server\'s own, and match without Polish letters', async () => {
  const { KLUBIS_STARTER } = await import('../src/config/klubisReplies.js');
  const { STARTER_VERSION, getTagData } = await import('../src/services/tagService.js');
  const { guild, chat, member } = setup('Start');
  const fresh = await getTagData(guild.id, { fresh: true });
  assert.equal(fresh.responders.length, KLUBIS_STARTER.length);
  assert.equal(fresh.starterVersion, STARTER_VERSION);
  assert.ok(KLUBIS_STARTER.length <= 50);
  for (const entry of KLUBIS_STARTER) {
    assert.ok(entry.responses.length >= 1 && entry.responses.every((line) => line.length <= 500), entry.trigger);
    assert.ok(entry.trigger.split(' ').length >= 2, `a question, not one common word: ${entry.trigger}`);
    assert.ok(!/\d+\.\d+\.\d+\.\d+|:\d{4,5}\b/.test(entry.responses.join(' ')), 'no server address');
  }
  const asked = message(guild, chat, member, 'Ej, JAK ZAROBIC kase?');
  assert.equal(await handleTagMessage(asked, '!'), true);
  assert.match(chat.sent.at(-1).content, /\/daily/);

  // Deleted in the panel: not added again.
  await setResponders(guild.id, []);
  assert.equal((await getTagData(guild.id, { fresh: true })).responders.length, 0);

  // A server that already taught "kiedy film" keeps its own answer.
  const other = setup('Swoje');
  await setResponders(other.guild.id, [{ trigger: 'Kiedy film', mode: 'word', responses: ['Jutro!'] }]);
  const merged = (await getTagData(other.guild.id, { fresh: true })).responders;
  assert.equal(merged.filter((entry) => /kiedy film/i.test(entry.trigger)).length, 1);
  assert.deepEqual(merged[0].responses, ['Jutro!']);
  assert.equal(merged.length, KLUBIS_STARTER.length);
});

test('"co robicie": 20 answers, always (no chance), its own break; "siema @Klubiś" is a greeting', async () => {
  const doing = lines('doingAll');
  assert.equal(doing.length, 20);
  assert.equal(new Set(doing).size, 20);
  assert.equal(lines('doing'), doing, '"co robisz" to Klubiś uses the same lines');
  for (const text of ['co robicie', 'Co robicie?', 'siema, co robicie', 'co tam robicie ludzie', 'co porabiacie', 'co dziś robimy']) {
    assert.equal(findSkill(fold(text), text, { aloneOnly: true })?.id, 'doingAll', text);
  }
  assert.equal(findSkill('co robisz', 'co robisz', { aloneOnly: true }), null, 'one person asking another is not for Klubiś');

  const { guild, chat, member } = setup('Co robicie');
  await saveKlubisSettings(guild.id, { chance: 0, cooldownMinutes: 3 });
  const first = await say(message(guild, chat, member, 'co robicie?'));
  assert.ok(doing.includes(first.content), 'answers although the chance is 0');
  assert.equal(await say(message(guild, chat, member, 'co robicie')), null, 'its break');
  tick(3 * 60_000);
  assert.ok(await say(message(guild, chat, member, 'a wy co robicie')));
  await saveKlubisSettings(guild.id, { phrases: false });
  tick(3 * 60_000);
  assert.equal(await say(message(guild, chat, member, 'co robicie')), null, '"Sam z siebie" off silences it');

  const hi = await say(message(guild, chat, member, `siema <@${client.user.id}>`, { mentionBot: true }));
  assert.ok(filled(lines('hello'), 'Ola', guild.name).includes(hi.content), hi.content);
  const hiName = await say(message(guild, chat, member, 'elo klubiś'));
  assert.ok(filled(lines('hello'), 'Ola', guild.name).includes(hiName.content), hiName.content);
  const both = await say(message(guild, chat, member, 'siema klubiś, co robisz?'));
  assert.ok(doing.includes(both.content), 'the question wins over the greeting');
});
