// 2026-11-01: Klubiś answers messages (services/klubis.js, taught answers in tagService, panel module "Klubiś").
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import {
  KLUBIS_ABOUT, KLUBIS_CALLED, KLUBIS_FOLLOW, KLUBIS_FOLLOW_KINDS, KLUBIS_FOLLOW_SKILLS, KLUBIS_SKILLS, KLUBIS_STARTER, KLUBIS_UNKNOWN, KLUBIS_WELCOME_BACK,
} from '../src/config/klubisReplies.js';
import { PRESET_ALLOWED_WORDS, PRESET_SLURS, PRESET_WORDS } from '../src/config/automodPresets.js';
import * as GRAMMAR from '../src/config/klubisGrammar.js';
import { factsOf, parseSentence, plural, reflect, relationshipOf, touchyKind, understand, wordStem, yearsOld } from '../src/services/klubisBrain.js';
import { delayOf, sumOf } from '../src/services/klubisFacts.js';
import { asksLiveQuestion, knowledgeAnswer } from '../src/services/klubisKnowledge.js';
import { SMP_GROUPS, SMP_ITEMS, SMP_RECIPES } from '../src/config/klubisKnowledgeData.js';
import { QUIZ_QUESTIONS } from '../src/config/quizQuestions.js';
import { postQuestion as postQuiz } from '../src/services/quiz.js';
import { findBannedWord, findSlur } from '../src/services/automodService.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import {
  MEMBER_GAP_MS, callsKlubis, choiceOf, findSkill, fold, forgetKlubisMember, getKlubisSettings, handleKlubisMessage, likeOf, quoteOf, saveKlubisSettings,
} from '../src/services/klubis.js';
import { getFromDb } from '../src/utils/database.js';
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
let sentMessages = 0;
function message(guild, channel, member, content, { mentionBot = false, replyToBot = false, replyTo = null } = {}) {
  const botId = client.user.id;
  const users = new Collection();
  if (mentionBot || replyToBot || replyTo) users.set(botId, client.user);
  const msg = {
    guild, client, channel, channelId: channel.id, member, author: member.user, content,
    mentions: { users, roles: new Collection(), repliedUser: replyToBot || replyTo ? client.user : null },
    reference: replyTo ? { messageId: replyTo } : null,
    replies: [],
  };
  msg.reply = async (payload) => { msg.replies.push(payload); sentMessages += 1; msg.sentId = `sent-${sentMessages}`; return { id: msg.sentId }; };
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
  assert.ok(yesNo.content.length > 1, yesNo.content);

  const update = await say(message(guild, chat, member, `<@${client.user.id}> kiedy update`, { mentionBot: true }));
  assert.ok(filled(lines('update')).includes(update.content), update.content);

  const unknown = await say(message(guild, chat, member, 'klubiś banan traktor'));
  assert.ok(unknown.content.length > 1, 'never silent');

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
  const follow = [
    ...Object.values(KLUBIS_FOLLOW).flat(), ...Object.values(KLUBIS_FOLLOW_SKILLS).flatMap(Object.values).flat().filter((line) => line !== 'more'),
    ...KLUBIS_WELCOME_BACK, ...Object.values(KLUBIS_ABOUT),
    ...Object.values(GRAMMAR.SAID_ABOUT_SELF).flat(), ...GRAMMAR.ASKED_YES, ...GRAMMAR.ASKED_NO, ...GRAMMAR.SAID_ABOUT_ME, ...GRAMMAR.SAID_ABOUT_ME_GOOD, ...GRAMMAR.SAID_ABOUT_ME_BAD,
    ...GRAMMAR.SAID_OTHER, ...GRAMMAR.SAID_OTHER_GOOD, ...GRAMMAR.SAID_OTHER_BAD, ...GRAMMAR.ONE_WORD, ...GRAMMAR.LONG_TEXT, ...GRAMMAR.ASKED_TO_DO, ...GRAMMAR.HAVE_PERSON, ...GRAMMAR.SAID_INSULT,
    ...GRAMMAR.FEELINGS.flatMap(([, list]) => list), ...GRAMMAR.WONT_TOUCH, ...GRAMMAR.BEING_HIT, ...GRAMMAR.HITTING_OTHERS, ...GRAMMAR.ASKED_UNKNOWN, ...GRAMMAR.ASKED_TO_SAY, ...Object.values(GRAMMAR.LEARNED).flat(), ...Object.values(GRAMMAR.RECALLED).flat(),
  ];
  const all = [...KLUBIS_SKILLS.flatMap((skill) => skill.replies), ...follow];
  assert.ok(new Set(all).size + KLUBIS_UNKNOWN.length + KLUBIS_CALLED.length >= 700, `${new Set(all).size} lines`);
  for (const list of [...KLUBIS_SKILLS.map((skill) => skill.replies), KLUBIS_UNKNOWN, KLUBIS_CALLED]) {
    assert.equal(new Set(list).size, list.length, list[0]);
  }
  assert.equal(new Set(KLUBIS_SKILLS.map((skill) => skill.id)).size, KLUBIS_SKILLS.length);

  for (const list of Object.values(GRAMMAR.SAID_ABOUT_SELF)) assert.equal(new Set(list).size, list.length, list[0]);

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
  assert.equal(view.memory, true);
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
  assert.equal((await call('PATCH', `/guilds/${guild.id}/klubis`, { memory: false })).json.memory, false);
  assert.equal(saved.json.chance, 50);
  assert.deepEqual(saved.json.channels, [chat.id]);
  assert.deepEqual(saved.json.responders, [{ trigger: 'ile kosztuje vip', mode: 'contains', responses: ['VIP kosztuje 10 zł', 'Zajrzyj na pikczu.pl/donate'] }]);
  assert.equal((await getKlubisSettings(guild.id)).cooldownMinutes, 10);

  for (const body of [
    { chance: 101 }, { cooldownMinutes: -1 }, { enabled: 'tak' }, { memory: 'tak' }, { channels: ['1'] }, { channels: 'x' },
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

// 2026-11-01, owner: "brakuje mi takiego czegos ze on wie na co odpowiada".
test('a reply to Klubiś: it knows which of its messages it is, and what that message answered', async () => {
  const { guild, chat, member } = setup('Pamiec rozmowy');
  const other = mockMember(guild, mockUser('kuba-pamiec'));
  other.displayName = 'Kuba';
  const first = message(guild, chat, member, 'Klubiś, czy wygram w lotto?');
  const answer = await say(first);
  assert.ok(filled(lines('question')).some((line) => answer.content.endsWith(line)), answer.content);

  const recall = await say(message(guild, chat, member, 'na co odpowiadasz?', { replyTo: first.sentId }), { random: () => 0 });
  assert.equal(recall.content, `Odpisałem na: „czy wygram w lotto?”. A napisałem: „${answer.content}” 🧠`);

  // Somebody else replies to the same message: the same talk, not that member's own.
  const why = await say(message(guild, chat, other, 'czemu', { replyTo: first.sentId }), { random: () => 0 });
  assert.equal(why.content, KLUBIS_FOLLOW_SKILLS.question.why[0]);
  const really = await say(message(guild, chat, other, 'seriooo?', { replyTo: first.sentId }));
  assert.ok(filled(KLUBIS_FOLLOW_SKILLS.question.really.map((line) => line.replace('{asked}', 'czy wygram w lotto?').replace('{said}', answer.content))).includes(really.content), really.content);
});

test('"jeszcze" gets another line of the same skill, "xd" and "słabe" fit what was said', async () => {
  const { guild, chat, member } = setup('Pamiec zart');
  const joke = message(guild, chat, member, 'Klubiś, opowiedz żart');
  const told = await say(joke);
  assert.ok(lines('joke').includes(told.content));

  const next = message(guild, chat, member, 'jeszcze', { replyTo: joke.sentId });
  const second = await say(next);
  assert.ok(lines('joke').includes(second.content), second.content);
  assert.notEqual(second.content, told.content);

  const laugh = await say(message(guild, chat, member, 'xddd', { replyTo: next.sentId }));
  assert.ok(KLUBIS_FOLLOW_SKILLS.joke.laugh.includes(laugh.content), laugh.content);
  const bad = await say(message(guild, chat, member, 'słabe', { replyTo: next.sentId }));
  assert.ok(KLUBIS_FOLLOW_SKILLS.joke.bad.some((line) => bad.content === line.replace('{said}', second.content)), bad.content);
  const again = await say(message(guild, chat, member, 'tak', { replyTo: next.sentId }));
  assert.ok(lines('joke').includes(again.content), 'tak = another one');
});

test('a call by name continues the last talk for a while; an answer without a call starts one too', async () => {
  const { guild, chat, member } = setup('Pamiec imie');
  await say(message(guild, chat, member, 'Klubiś, czy pada?'));
  const why = await say(message(guild, chat, member, 'klubiś czemu'));
  assert.ok(KLUBIS_FOLLOW_SKILLS.question.why.some((line) => why.content === line.replace('{asked}', 'czy pada?')), why.content);

  tick(11 * 60_000);
  const late = await say(message(guild, chat, member, 'klubiś czemu'));
  assert.ok(lines('askWhy').includes(late.content), late.content);

  await saveKlubisSettings(guild.id, { cooldownMinutes: 0 });
  const alone = message(guild, chat, member, 'co robicie?');
  await say(alone);
  const asked = await say(message(guild, chat, member, 'czemu', { replyTo: alone.sentId }));
  assert.ok(KLUBIS_FOLLOW_SKILLS.doingAll.why.includes(asked.content), asked.content);
});

test('a reply nothing understood says which talk it belongs to, half of the time', async () => {
  const { guild, chat, member } = setup('Pamiec nie wiem');
  const first = message(guild, chat, member, 'Klubiś, banan traktor');
  const unknown = await say(first);
  const stay = await say(message(guild, chat, member, 'traktor banan', { replyTo: first.sentId }), { random: () => 0 });
  assert.equal(stay.content, `Czyli to odpowiedź na moje „${unknown.content}”? Nie wiem, co na to powiedzieć 😅`);
  const plain = await say(message(guild, chat, member, 'traktor banan', { replyTo: first.sentId }), { random: () => 0.9 });
  assert.ok(!plain.content.startsWith('Czyli'), plain.content);
  assert.ok(!(await say(message(guild, chat, member, 'klubiś traktor banan'), { random: () => 0 })).content.startsWith('Czyli'), 'a call by name is not a reply');
});

test('what the member wrote is said back only when it is safe', async () => {
  assert.equal(quoteOf('<@123456789012345678> @everyone zobacz https://x.pl **hej** `kod`'), 'everyone zobacz hej kod');
  assert.equal(quoteOf('KLUBIŚ, co tam?'), 'co tam?');
  assert.equal(quoteOf('x'.repeat(100)).length, 63);
  const banned = PRESET_WORDS.find((word) => !word.includes('*') && !touchyKind(word));
  const slur = PRESET_SLURS.find((word) => !word.includes('*'));
  assert.equal(quoteOf(`to ${banned} jest`), `to ${banned} jest`, 'the words list is the server\'s business, automod runs first');
  assert.equal(quoteOf(`to ${slur} jest`), '');

  const { guild, chat, member } = setup('Pamiec cytat');
  const first = message(guild, chat, member, `klubiś to ${slur} jest`);
  const answer = await say(first);
  assert.ok(GRAMMAR.WILL_NOT_REPEAT.includes(answer.content), answer.content);
  const recall = await say(message(guild, chat, member, 'na co odpowiadasz', { replyTo: first.sentId }));
  assert.ok(!recall.content.includes(slur), recall.content);
  assert.ok(recall.content.includes(answer.content.slice(0, 20)), recall.content);
  assert.deepEqual(recall.allowedMentions, { parse: [], repliedUser: false });
});

test('a reply to the helpline answer or to a sad one is never a joke', async () => {
  const { guild, chat, member } = setup('Pamiec powaznie');
  for (const [text, id] of [['Klubiś, nie chcę żyć', 'crisis'], ['Klubiś, smutno mi', 'sad']]) {
    const first = message(guild, chat, member, text);
    assert.ok(filled(lines(id)).includes((await say(first)).content));
    for (const reply of ['nie', 'xd', 'czemu', 'banan traktor']) {
      const answer = await say(message(guild, chat, member, reply, { replyTo: first.sentId }));
      assert.ok(filled(lines(id)).includes(answer.content), `${reply}: ${answer.content}`);
    }
  }
});

test('the long memory: what a member likes, how many talks, a long break, and forgetting', async () => {
  assert.equal(likeOf('Lubię grać w minecraft, a ty?'), 'grać w minecraft');
  assert.equal(likeOf('klubiś uwielbiam pizzę'), 'pizzę');
  assert.equal(relationshipOf('kocham Anię').loves, 'Anię', 'server 16+: the owner lifted that limit');
  for (const text of ['lubię cię', 'lubię to', 'lubię 123456789', 'nie lubię szkoły', 'jak lubisz', 'lubię bardzo długie zdania które nie mają końca i są o niczym']) {
    assert.equal(likeOf(text), null, text);
  }

  const { guild, chat, member } = setup('Pamiec dluga');
  await say(message(guild, chat, member, 'Klubiś, lubię grać w minecraft, a ty?'));
  const stored = await getFromDb(`guild:${guild.id}:klubis-memory`, { members: {} });
  assert.deepEqual(stored.members[member.user.id].likes, ['grać w minecraft']);
  assert.ok(!(await say(message(guild, chat, member, 'Klubiś, lubię grać w minecraft'))).content.includes('Zapamiętam'), 'once is enough');
  const about = await say(message(guild, chat, member, 'klubiś co o mnie wiesz?'));
  assert.match(about.content, /Pewnie, że pamiętam, Ola! Znam cię od \d+ \S+, mamy za sobą 2 rozmowy\..*Lubisz: grać w minecraft 📓/);

  tick(4 * 86_400_000);
  const back = await say(message(guild, chat, member, 'klubiś siema'));
  assert.ok(filled(KLUBIS_WELCOME_BACK).some((line) => back.content === line.replace('{days}', '4')), back.content);
  assert.ok(filled(lines('hello'), 'Ola', guild.name).includes((await say(message(guild, chat, member, 'klubiś siema'))).content), 'no break any more');

  await say(message(guild, chat, member, 'klubiś zapomnij o mnie'));
  const after = await say(message(guild, chat, member, 'klubiś co o mnie wiesz'));
  assert.ok(filled(lines('aboutMe')).includes(after.content), after.content);
  await forgetKlubisMember(guild.id, member.user.id);

  await saveKlubisSettings(guild.id, { memory: false });
  const off = await say(message(guild, chat, member, 'Klubiś, lubię pizzę'));
  assert.ok(!off.content.includes('Zapamiętam'));
  assert.equal((await getFromDb(`guild:${guild.id}:klubis-memory`, { members: {} })).members[member.user.id], undefined, 'off = nothing is written');
});

test('every follow-up skill exists', () => {
  const ids = new Set([...KLUBIS_SKILLS.map((skill) => skill.id), 'unknown']);
  assert.deepEqual(Object.keys(KLUBIS_FOLLOW_SKILLS).filter((id) => !ids.has(id)), []);
  const kinds = new Set(KLUBIS_FOLLOW_KINDS.map((kind) => kind.id));
  assert.deepEqual(Object.values(KLUBIS_FOLLOW_SKILLS).flatMap(Object.keys).filter((kind) => !kinds.has(kind)), []);
  // `recall` has `recallAlone` for a message it cannot quote.
  for (const [kind, list] of Object.entries(KLUBIS_FOLLOW)) if (kind !== 'recall') assert.ok(list.some((line) => !line.includes('{asked}')), `${kind}: needs a line without a quote`);
});

// 2026-11-01, owner: "rozwin to tak zeby te odpowiedzi mialy sens prawie zawsze, sprobuj zrobic tak zeby on rozumial".
test('a sentence said from the other side', () => {
  const said = (text) => reflect(parseSentence(text).words).join(' ');
  assert.equal(said('lubię pizzę'), 'lubisz pizzę');
  assert.equal(said('lubie placki'), 'lubisz placki', 'without Polish letters too');
  assert.equal(said('mój brat mnie wkurza'), 'twój brat cię wkurza');
  assert.equal(said('wczoraj grałem w cs'), 'wczoraj grałeś w cs');
  assert.equal(said('zrobilam ciasto'), 'zrobiłaś ciasto');
  assert.equal(said('poszedłem z Michałem na spacer'), 'poszedłeś z Michałem na spacer', 'a name after a preposition is no verb');
  assert.equal(said('grasz ze mną'), 'gram z tobą');
  assert.equal(said('byłeś u mnie'), 'byłem u ciebie');
  assert.equal(said('kocham moją mamę'), 'kochasz twoją mamę');
});

test('who a sentence is about', () => {
  const read = (text) => {
    const { person, group, negated, past, question, asks, qSkill, asksBack, greeted } = parseSentence(text);
    return { person, group, negated, past, question, asks, qSkill, asksBack, greeted };
  };
  assert.deepEqual(read('no ja dzisiaj nie gram w cs'), { person: 'me', group: 'play', negated: true, past: false, question: false, asks: false, qSkill: null, asksBack: false, greeted: false });
  assert.deepEqual(read('siema lubię pizzę, a ty?'), { person: 'me', group: 'like', negated: false, past: false, question: false, asks: false, qSkill: null, asksBack: true, greeted: true });
  assert.equal(read('lubisz pizzę?').person, 'you');
  assert.equal(read('wczoraj grałaś?').person, 'you');
  assert.equal(read('kuba gra w cs').person, 'other');
  assert.equal(read('czy wygram?').asks, true);
  assert.equal(read('gdzie jest mój telefon').qSkill, 'askWhere');
  assert.equal(read('a kiedy to będzie').qSkill, 'askWhen');
});

test('answers fit the sentence: what it says back is the member\'s own words', async () => {
  const { guild, chat, member } = setup('Rozumie');
  const answer = async (text) => (await say(message(guild, chat, member, `klubiś ${text}`), { random: () => 0.99 })).content;
  assert.match(await answer('kuba to debil'), /obrażania|lubić|gorszy dzień|przeczyta|tak mówisz|wtrącam/, 'not about Klubiś');
  assert.ok(!lines('mean').includes(await answer('ten film jest słaby')), 'not about Klubiś');
  assert.ok(filled(lines('mean')).includes(await answer('jesteś głupi')));
  assert.ok((await answer('gdzie jest mój telefon?')).length > 5);
  assert.match(await say(message(guild, chat, member, 'klubiś lubisz pizzę?'), { random: () => 0.99 }).then((reply) => reply.content), /^Czy lubię pizzę\? /);
  assert.match(await say(message(guild, chat, member, 'klubiś zrób mi kanapkę'), { random: () => 0.99 }).then((reply) => reply.content), /^Mam zrobić ci kanapkę\? /);
  assert.ok(lines('hello').length && (await answer('siema')).length > 2);
  assert.ok(KLUBIS_CALLED.map((line) => line.replace('{user}', 'Ola')).includes(await answer('ej')), 'only calling');
});

test('the same question gets the same side, and sentences are not treated as questions', () => {
  const side = (text) => {
    const { line, skillId } = understand(parseSentence(text), { pick: (list) => list[0], random: () => 0.99 });
    assert.equal(skillId, 'question', text);
    return GRAMMAR.ANSWER_YES.includes(line) ? 'yes' : GRAMMAR.ANSWER_NO.includes(line) ? 'no' : 'maybe';
  };
  for (const text of ['czy wygram w lotto?', 'czy pikczu ma psa', 'jutro będzie padać?']) assert.equal(side(text), side(text), text);
  assert.equal(new Set(['czy a?', 'czy b?', 'czy c?', 'czy d?', 'czy e?', 'czy f?', 'czy g?', 'czy h?'].map(side)).size > 1, true, 'not always the same side');
});

test('what a member says about themselves is remembered, never a phone number or a password', () => {
  const facts = (text) => factsOf(parseSentence(text));
  assert.deepEqual(facts('mam na imię ania'), { name: 'Ania' });
  assert.deepEqual(facts('mam 17 lat'), { age: 17 });
  assert.deepEqual(facts('mów mi kacper'), { name: 'Kacper' });
  assert.deepEqual(facts('nazywam się Ania'), { name: 'Ania' });
  assert.deepEqual(facts('jestem z Krakowa'), { city: 'z Krakowa' });
  assert.deepEqual(facts('mieszkam w Gdańsku'), { city: 'w Gdańsku' });
  assert.deepEqual(facts('gram w fortnite'), { plays: 'w fortnite' });
  assert.deepEqual(facts('nie lubię szkoły'), { dislikes: 'szkoły' });
  assert.deepEqual(facts('lubię pizzę, a ty?'), { likes: 'pizzę' });
  for (const text of ['mam numer 123456789', 'lubię adres ulica 5', 'mam hasło qwerty', 'lubisz pizzę', 'lubię pizzę?', 'czy lubię pizzę']) {
    assert.deepEqual(facts(text), {}, text);
  }
});

test('real answers: sums, money, level, the date, the server, other members', async () => {
  assert.equal(sumOf('ile to 2+2*2'), '2+2×2 = 6 🧮');
  assert.equal(sumOf('klubiś policz 15 razy 3'), '15 razy 3 = 45 🧮');
  assert.equal(sumOf('ile to 10/4'), '10/4 = 2,5 🧮');
  assert.equal(sumOf('2+2'), '2+2 = 4 🧮');
  assert.match(sumOf('ile to 1/0'), /zero/);
  assert.equal(sumOf('mam 2 koty i 3 psy'), null);
  assert.equal(sumOf('w 2020 było 5-6 osób'), null, 'nobody asked');

  const { guild, chat, member } = setup('Fakty');
  const answer = async (text) => (await say(message(guild, chat, member, `klubiś ${text}`), { random: () => 0.99 })).content;
  assert.match(await answer('ile mam kasy?'), /w portfelu i .* w banku/);
  assert.match(await answer('jaki mam poziom?'), /^Masz poziom \d+ i \d+ XP/);
  assert.match(await answer('ile mam warnów?'), /zero ostrzeżeń/);
  assert.match(await answer('kiedy daily?'), /odbierz/);
  assert.match(await answer('która godzina?'), /^Jest \d\d:\d\d/);
  assert.match(await answer('jaki dziś dzień?'), /^Dzisiaj /);
  assert.match(await answer('ile osób jest na serwerze?'), /^Na serwerze (jest|są) \d+ (osoba|osoby|osób)/);

  const other = mockMember(guild, mockUser('kuba-fakty'));
  const asked = message(guild, chat, member, `klubiś kim jest <@${other.user.id}>?`);
  asked.mentions.users.set(client.user.id, client.user);
  asked.mentions.users.set(other.user.id, other.user);
  const about = await say(asked);
  assert.match(about.content, new RegExp(`^<@${other.user.id}>.*poziom \\d+`));
  assert.deepEqual(about.allowedMentions, { parse: [], repliedUser: false }, 'no ping');
});

test('what the channel talks about', async () => {
  const { guild, chat, member } = setup('Kanal');
  for (const text of ['ten minecraft jest super', 'minecraft to dobra gra', 'kto gra w minecraft dzisiaj']) {
    await handleKlubisMessage(message(guild, chat, member, text), { now: tick(1000), random: () => 0.99 });
  }
  const summary = await say(message(guild, chat, member, 'klubiś o czym gadacie?'));
  assert.match(summary.content, /^Ostatnio tutaj: minecraft/);
  assert.match(summary.content, /Najwięcej piszą: Ola/);
});

test('pick-up lines: for who was named, silly, without a ping', async () => {
  const { guild, chat, member } = setup('Podryw');
  const flirt = lines('flirt');
  assert.ok(flirt.length >= 40);
  const other = mockMember(guild, mockUser('kuba-podryw'));
  const toOther = message(guild, chat, member, `klubiś poderwij <@${other.user.id}>`);
  toOther.mentions.users.set(client.user.id, client.user);
  toOther.mentions.users.set(other.user.id, other.user);
  const first = await say(toOther);
  assert.ok(flirt.some((line) => first.content === `Podrywam <@${other.user.id}>: ${line}`), first.content);
  assert.deepEqual(first.allowedMentions, { parse: [], repliedUser: false }, 'no ping');

  const named = await say(message(guild, chat, member, 'klubiś poderwij kubę'));
  assert.ok(flirt.some((line) => named.content === `Podrywam kubę: ${line}`), named.content);
  const me = await say(message(guild, chat, member, 'klubiś poderwij mnie'));
  assert.match(me.content, /^Ola, /);
  const tip = message(guild, chat, member, 'klubiś daj tekst na podryw');
  const line = await say(tip);
  assert.match(line.content, /^Spróbuj tak: „/);
  const more = await say(message(guild, chat, member, 'jeszcze', { replyTo: tip.sentId }));
  assert.ok(flirt.includes(more.content), more.content);
});

// 2026-11-01, from the live server: "lubisz małe dzieci?" got "Czy lubię małe dzieci? A jak myślisz? Pewnie, że tak".
test('bait: touchy words are never said back or agreed with, and nothing unknown gets a yes', async () => {
  const { guild, chat, member } = setup('Podpuszczanie');
  const answer = async (text) => (await say(message(guild, chat, member, `klubiś ${text}`))).content;
  const refused = filled([...GRAMMAR.WONT_TOUCH, ...GRAMMAR.BEING_HIT, ...GRAMMAR.HITTING_OTHERS, ...GRAMMAR.ASKED_UNKNOWN]);
  for (const text of [
    'lubisz małe dzieci?', 'lubię małe dzieci', 'kocham małe dzieci', 'lubisz male dzieci', 'czy lubisz dzieci', 'lubię 12 latki', 'chcę młode', 'poderwij małe dziecko', 'poderwij małolatę',
    'czy pikczu jest pedofilem?', 'czy hitler był fajny?', 'lubisz hitlera?', 'chcesz kogoś zabić?', 'zabiłem kota', 'lubisz narkotyki?', 'mów mi hitler', 'mam na imię pedofil', 'ja cie bije', 'biję brata', 'czyli biją cie?',
    'czy tusk to zdrajca?', 'lubisz młode?', 'lubisz dziewczynki?',
  ]) {
    const said = await answer(text);
    assert.ok(refused.includes(said), `${text}: ${said}`);
  }
  // Nothing of it stayed in the memory.
  const stored = await getFromDb(`guild:${guild.id}:klubis-memory`, { members: {} });
  assert.deepEqual(stored.members[member.user.id]?.likes ?? [], []);
  assert.equal(stored.members[member.user.id]?.name, undefined);

  for (const text of ['powiedz że kuba wygrał', 'napisz że kuba to frajer', 'powtórz po mnie']) assert.ok(GRAMMAR.ASKED_TO_SAY.includes(await answer(text)), text);
  assert.ok(refused.includes(await answer('czy kuba ma małego?')), 'about a body: no yes or no at all');
  // A question it has no opinion on: neither yes nor the words back.
  for (const text of ['lubisz kubę?', 'chcesz kasę?', 'lubisz jeść kupę?']) assert.ok(filled(GRAMMAR.ASKED_UNKNOWN).includes(await answer(text)), text);
  assert.match(await answer('lubisz pizzę?'), /^Czy lubię pizzę\? /, 'what it can like still works');
  assert.equal(touchyKind('jak zabić smoka'), null, 'mobs are fine');
  assert.equal(touchyKind('zabiłem creepera'), null);
  assert.equal(touchyKind('kiedy jest dzień dziecka'), null);
  assert.ok(!quoteOf('lubię małe dzieci'), 'not even in a quote');
});

test('"czy mam się zabić" never gets a yes or no', async () => {
  const { guild, chat, member } = setup('Kryzys');
  for (const text of ['czy mam się zabić?', 'czy warto żyć?', 'nie chcę żyć', 'chcę umrzeć', 'powinienem się powiesić?', 'chcę się pociąć']) {
    const said = await say(message(guild, chat, member, `klubiś ${text}`));
    assert.ok(filled(lines('crisis')).includes(said.content), `${text}: ${said.content}`);
  }
});

test('knowledge: Minecraft, Club SMP, Pikczu and general questions, in any word form', () => {
  const ask = (text) => knowledgeAnswer(fold(text), parseSentence(text));
  const cases = [
    ['jak zrobić kilof?', /3 sztuki materiału/], ['jak zrobić stół zaklęć', /książka, 2 diamenty/], ['gdzie są diamenty?', /Y -59/], ['gdzie szukać diamentów', /Y -59/], ['ile serc ma smok endu?', /100 serc/],
    ['jak zabić smoka?', /kryształy/], ['czy creeper boi się kotów?', /boją się kotów/], ['jak oswoić wilka?', /kośćmi/], ['jak zrobić portal do netheru', /obsydian/], ['co to netheryt', /najlepszy materiał/],
    ['stolica francji', /Paryż/], ['jaka jest stolica Ukrainy?', /Kijów/], ['ile jest planet?', /8 planet/], ['kiedy była bitwa pod grunwaldem', /1410/], ['najwyższa góra świata', /Everest/], ['najwyższy szczyt polski', /Rysy/],
    ['kim jest pikczu', /Dawid Sikora/], ['jak się naprawdę nazywa pikczu', /Dawid Sikora/], ['skąd jest pikczu', /Katowice/], ['w czym montuje pikczu', /Premiere/],
    ['co to miecz boga', /Miecz Boga/], ['jak zrobić czekan', /Czekan.*Sztabka/], ['jak zrobić rzadką skrzynkę', /Zwykła Skrzynka/], ['co to rzadka skrzynka', /Rzadka Skrzynka/],
    ['co robi /napad', /wspólny skok/], ['jak działa rob', /80%/], ['co to sigma', /memów/], ['co to ram', /pamięć/],
    ['jakiego kilofa na obsydian', /diamentow/i], ['ile bloków obsydianu na portal do netheru', /10/], ['kto napisał pana tadeusza', /Mickiewicz/],
  ];
  for (const [text, expected] of cases) assert.match(ask(text) ?? '', expected, text);
  for (const text of ['mam miecz boga', 'gram w minecrafta', 'lubisz creepery?', 'kocham diamenty', 'wczoraj znalazłem diamenty', 'zabiłem smoka']) assert.equal(ask(text), null, text);
});

test('Club SMP data has no address, and no answer is too long for a message', () => {
  const text = JSON.stringify([SMP_GROUPS, SMP_ITEMS, SMP_RECIPES]);
  assert.ok(SMP_ITEMS.length > 100 && SMP_RECIPES.length > 10);
  assert.doesNotMatch(text, /mathost|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|play\.[a-z]/i);
  for (const item of [...SMP_GROUPS, ...SMP_ITEMS, ...SMP_RECIPES]) assert.ok(item.text.length < 2000, item.name);
});

test('the question a quiz pays for gets no help while it runs', async () => {
  const { guild, chat, member } = setup('Bez sciagania');
  const running = await postQuiz(guild, chat, { now: tick(1000), random: () => 0 });
  const { q } = QUIZ_QUESTIONS[running.index];
  assert.equal(asksLiveQuestion(fold(q), q), true);
  assert.equal(asksLiveQuestion('jak zrobic kanapke z serem', q), false);
  assert.match((await say(message(guild, chat, member, `klubiś ${q}`))).content, /nie podpowiadam/);
  assert.match((await say(message(guild, chat, member, 'klubiś stolica francji'))).content, /Paryż/, 'other questions still get answers');
});

test('from the live server: a mention in the question, quotes, a question with a preposition', async () => {
  const { guild, chat, member } = setup('Na zywo');
  const other = mockMember(guild, mockUser('vvikuu'));
  const asked = message(guild, chat, member, `co myslisz o <@${other.user.id}>`, { mentionBot: true });
  asked.mentions.users.set(other.user.id, other.user);
  assert.match((await say(asked)).content, new RegExp(`<@${other.user.id}>.*poziom`));
  const quoted = (await say(message(guild, chat, member, 'klubiś "COŚ"'))).content;
  assert.ok(!quoted.includes('"'), quoted);
  assert.equal(parseSentence('na jaka platforme').qSkill, 'askWhich');
  assert.equal(parseSentence('w czym montuje pikczu').qSkill, 'askWhat');
});

// 2026-11-01, owner: "odmiany polskie go naucz".
test('verbs: any person, known or not, said from the other side', () => {
  const said = (text) => reflect(parseSentence(text).words).join(' ');
  const cases = [
    // The table.
    ['ja cie bije', 'ty mnie bijesz'], ['myję auto', 'myjesz auto'], ['krzyczę na brata', 'krzyczysz na brata'], ['noszę czapkę', 'nosisz czapkę'], ['płacę kartą', 'płacisz kartą'],
    // By the ending, verbs that are in no table.
    ['konstruuję most', 'konstruujesz most'], ['pracuje dzisiaj', 'pracujesz dzisiaj'], ['ja rozwijam serwer', 'ty rozwijasz serwer'], ['wymyślam nazwę', 'wymyślasz nazwę'], ['tęsknię za domem', 'tęsknisz za domem'],
    ['nie zgaduję', 'nie zgadujesz'], ['kolekcjonuję karty', 'kolekcjonujesz karty'],
    // To Klubiś.
    ['rozwijasz serwer?', 'rozwijam serwer'], ['konstruujesz most?', 'konstruuję most'], ['robisz błędy', 'robię błędy'], ['uczysz się?', 'uczę się'], ['dajesz radę?', 'daję radę'], ['ciągniesz to?', 'ciągnę to'],
    // Past, for her and for him, and for Klubiś.
    ['zrobilam ciasto', 'zrobiłaś ciasto'], ['poszedłem spać', 'poszedłeś spać'], ['byłaś tam?', 'byłem tam'], ['mogłem wygrać', 'mogłeś wygrać'],
    // We, and the conditional.
    ['gramy w cs', 'gracie w cs'], ['robimy serwer', 'robicie serwer'], ['byliśmy w kinie', 'byliście w kinie'], ['chciałbym psa', 'chciałbyś psa'], ['zrobiłabym ciasto', 'zrobiłabyś ciasto'], ['chciałbyś psa?', 'chciałbym psa'],
    // Not verbs.
    ['program jest dobry', 'program jest dobry'], ['nasz serwer żyje', 'wasz serwer żyje'], ['wodę piję', 'wodę pijesz'], ['tam jest fajnie', 'tam jest fajnie'],
    // Polish letters in what comes back.
    ['grałem cala noc', 'grałeś cała noc'], ['zrobilam dzis ciasto', 'zrobiłaś dziś ciasto'], ['bede juz spal', 'będziesz już spal'],
  ];
  for (const [text, expected] of cases) assert.equal(said(text), expected, text);
  assert.equal(parseSentence('rozwijam serwer').person, 'me');
  assert.equal(parseSentence('rozwijasz serwer').person, 'you');
  assert.equal(parseSentence('kuba rozwija serwer').person, 'other');
  assert.equal(parseSentence('byliśmy w kinie').past, true);
});

test('numbers and nouns agree', () => {
  const cases = [[1, 'rok'], [2, 'lata'], [4, 'lata'], [5, 'lat'], [12, 'lat'], [14, 'lat'], [17, 'lat'], [21, 'lat'], [22, 'lata'], [24, 'lata'], [25, 'lat'], [102, 'lata'], [112, 'lat'], [0, 'lat']];
  for (const [count, form] of cases) assert.equal(plural(count, 'rok', 'lata', 'lat'), form, String(count));
  assert.equal(yearsOld(22), '22 lata');
});

test('the same thing in any case is found', () => {
  assert.deepEqual(wordStem('boga'), { prefix: 'bog', also: 'bodz' });
  const ask = (text) => knowledgeAnswer(fold(text), parseSentence(text));
  for (const text of ['co to miecz boga', 'co wiesz o mieczu boga', 'jak działa miecz boga', 'opowiedz o mieczu boga']) assert.match(ask(text) ?? '', /Miecz Boga/, text);
  for (const text of ['co to rzadka skrzynka', 'co wiesz o rzadkiej skrzynce', 'jak działa rzadka skrzynka', 'opowiedz o rzadkiej skrzynce']) assert.match(ask(text) ?? '', /Rzadka Skrzynka/, text);
  for (const text of ['gdzie są diamenty?', 'gdzie szukać diamentów', 'gdzie znajdę diament', 'na jakim poziomie diamenty']) assert.match(ask(text) ?? '', /Y -59/, text);
});

test('age and counts read right', async () => {
  const { guild, chat, member } = setup('Liczby');
  const answer = async (text) => (await say(message(guild, chat, member, `klubiś ${text}`), { random: () => 0.99 })).content;
  assert.match(await answer('mam 22 lata'), /22 lata/);
  assert.match(await answer('ile mam lat?'), /22 lata/);
  assert.match(await answer('co o mnie wiesz'), /22 lata/);
  assert.match(await answer('ile lat ma pikczu'), /ma \d+ (lat|lata|rok)/);
});

// 2026-11-01, owner with a screenshot: "jak sie pyta kogo kocham to nie dziala, niech pamieta jak sie napisze ze jestem w zwiazku z @osoba".
test('it remembers who a member loves and is with, and "zapamiętaj, że ..."', async () => {
  assert.deepEqual(relationshipOf('kocham szeldis'), { loves: 'szeldis' });
  assert.deepEqual(relationshipOf('Klubiś, kocham <@123456789012345678>'), { loves: '<@123456789012345678>' });
  assert.deepEqual(relationshipOf('jestem w związku z <@123456789012345678>'), { partner: 'Jesteś w związku z <@123456789012345678>' });
  assert.deepEqual(relationshipOf('jestem z <@123456789012345678>'), { partner: 'Jesteś z <@123456789012345678>' });
  assert.deepEqual(relationshipOf('chodzę z Anią'), { partner: 'Chodzisz z Anią' });
  assert.deepEqual(relationshipOf('moja dziewczyna to Ania'), { partner: 'Twoja dziewczyna to Ania' });
  assert.deepEqual(relationshipOf('A czy ty możesz zapamiętać że kocham szeldis?'), { note: 'kochasz szeldis', loves: 'szeldis' });
  assert.deepEqual(relationshipOf('zapamiętaj że mam psa'), { note: 'masz psa' });
  for (const text of ['kocham cię', 'kocham to', 'jestem z Krakowa', 'zapamiętaj że lubię małe dzieci', 'zapamiętaj mój numer 123456789', 'lubię pizzę']) {
    assert.deepEqual(relationshipOf(text), {}, text);
  }

  const { guild, chat, member } = setup('Zwiazki');
  const other = mockMember(guild, mockUser('szeldis'));
  const talk = async (text, mention = null) => {
    const msg = message(guild, chat, member, `klubiś ${text}`);
    msg.mentions.users.set(client.user.id, client.user);
    if (mention) msg.mentions.users.set(mention.user.id, mention.user);
    return (await say(msg, { random: () => 0.99 })).content;
  };
  assert.match(await talk('kogo kocham?'), /Jeszcze mi tego|notes jest pusty|Tego jeszcze/);
  assert.match(await talk('A czy ty możesz zapamiętać że kocham szeldis?'), /szeldis/);
  assert.match(await talk('kogo kocham?'), /szeldis/);
  assert.match(await talk(`jestem w związku z <@${other.user.id}>`, other), new RegExp(`Jesteś w związku z <@${other.user.id}>`));
  assert.match(await talk('z kim jestem?'), new RegExp(`Jesteś w związku z <@${other.user.id}>`));
  assert.match(await talk('co o mnie wiesz?'), /szeldis/);
  assert.match(await talk('co zapamiętałeś?'), /kochasz szeldis/);
  await talk('zapomnij o mnie');
  assert.match(await talk('kogo kocham?'), /Jeszcze mi tego|notes jest pusty|Tego jeszcze/, 'forgotten');
});

// 2026-11-01, owner: "niech pamieta duzo o ludziach, dodaj mu wiecej umiejetnosci, wiekszy mozg, wiecej rozumienia".
test('the notebook: what a member said about themselves comes back when asked', async () => {
  const { guild, chat, member } = setup('Notes');
  const say2 = async (text) => (await say(message(guild, chat, member, `klubiś ${text}`), { random: () => 0.99 })).content;
  for (const text of ['mój pies ma na imię Burek', 'mój ulubiony kolor to zielony', 'wczoraj byłem w kinie', 'gram na gitarze', 'pracuję w sklepie', 'chodzę do technikum']) await say2(text);
  assert.match(await say2('jak ma na imię mój pies?'), /twój pies ma na imię Burek/i);
  assert.match(await say2('jaki jest mój ulubiony kolor?'), /twój ulubiony kolor to zielony/i);
  assert.match(await say2('gdzie pracuję?'), /pracujesz w sklepie/i);
  await say2('kocham szeldis');
  await say2('A czy ty możesz zapamiętać że mam kota?');
  assert.match(await say2('czy mam kota?'), /masz kota/, 'a note counts, and "kota" is not "kochasz"');
  assert.match(await say2('do jakiej szkoły chodzę?') + await say2('co mam wspólnego z technikum?'), /technikum/i);
  assert.match(await say2('co o mnie wiesz?'), /ostatnio: /);

  const stored = (await getFromDb(`guild:${guild.id}:klubis-memory`, { members: {} })).members[member.user.id];
  assert.ok(stored.said.includes('wczoraj byłeś w kinie'), JSON.stringify(stored.said));
  await say2('mam numer 123456789');
  await say2('moje hasło to qwerty');
  await say2('mój adres to ulica Długa');
  const after = (await getFromDb(`guild:${guild.id}:klubis-memory`, { members: {} })).members[member.user.id];
  assert.ok(!after.said.join(' ').match(/123456789|qwerty|Długa/), 'no secrets');
  await say2('zapomnij o mnie');
  assert.equal((await getFromDb(`guild:${guild.id}:klubis-memory`, { members: {} })).members[member.user.id], undefined);
});

test('what it can really do: dice, coin, a number, picking, days to go, reminders', async () => {
  const { guild, chat, member } = setup('Umie');
  const answer = async (text, random = () => 0.5) => (await say(message(guild, chat, member, `klubiś ${text}`), { random })).content;
  assert.match(await answer('rzuć kostką'), /^🎲 Wypadło [1-6]$/);
  assert.match(await answer('rzuć monetą'), /^🪙 (Orzeł|Reszka)$/);
  assert.equal(await answer('wylosuj liczbę od 1 do 10', () => 0), '🎲 1');
  assert.match(await answer('na ile procent wygram?'), /^Na \d+%/);
  assert.equal(await answer('na ile procent wygram?'), await answer('na ile procent wygram?'), 'always the same');
  assert.match(await answer('ile dni do świąt?'), /^Do Wigilii zostało? \d+ dni|^Do Wigilii został/);
  assert.match(await answer('kiedy sylwester?'), /Sylwestra/);

  assert.equal(choiceOf('pizza czy burger?', () => 0), 'Pizza. Bez zastanowienia 👉');
  assert.equal(choiceOf('pizza czy burger?', () => 0.9), 'Burger. Bez zastanowienia 👉');
  assert.equal(choiceOf('wybierz: kot, pies, chomik', () => 0.5), 'Pies. Bez zastanowienia 👉');
  assert.equal(choiceOf('czy kuba jest bardzo fajny czy może jednak trochę głupi i nudny'), null, 'not a list of short things');
  assert.match(await answer('kot czy pies?', () => 0), /^Kot\. /);

  assert.equal(delayOf('przypomnij mi za 10 minut o obiedzie'), 600_000);
  assert.equal(delayOf('za 2 godziny'), 7_200_000);
  assert.equal(delayOf('za pol godziny'), 1_800_000);
  assert.equal(delayOf('jutro'), null);
  const set = await answer('przypomnij mi za 1 sekund o obiedzie');
  assert.match(set, /przypomnę .*obiedzie/);
  assert.match(await answer('przypomnij mi coś'), /Kiedy\?/);
  const sent = chat.sent.length;
  await new Promise((resolve) => { setTimeout(resolve, 1100); });
  assert.equal(chat.sent.length, sent + 1);
  assert.match(chat.sent.at(-1).content, new RegExp(`<@${member.user.id}>, przypominam: obiedzie`));
  assert.deepEqual(chat.sent.at(-1).allowedMentions, { parse: [], users: [member.user.id] });
});

test('a greeting can mention what it remembers', async () => {
  const { guild, chat, member } = setup('Powitanie');
  await say(message(guild, chat, member, 'Klubiś, lubię pizzę'));
  const hi = await say(message(guild, chat, member, 'klubiś siema'), { random: () => 0 });
  assert.match(hi.content, /pizzę/);
});
