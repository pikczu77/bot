// Missions, badges and stats (2026-10-26): three daily and three weekly missions in Polish time,
// rewards paid at once, a free pack for a finished set, one swap per period, badges paid once.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { getEconomySettings, updateEconomySettings } from '../src/services/economySettings.js';
import {
  ACHIEVEMENTS, MISSIONS, ensureMissions, progressEmbeds, progressOptions, recordProgress, rerollMission,
} from '../src/services/progress.js';
import { dayKey, weekKey } from '../src/utils/warsawTime.js';
import missionsMenu from '../src/interactions/selectMenus/economy/missions.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let settings;

before(async () => {
  progressOptions.enabled = true;
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Misje');
  channel = mockChannel(guild, 'ekonomia');
  settings = await updateEconomySettings(guild.id, (data) => {
    data.currency = { symbol: '$', position: 'left', separator: ',' };
    data.earningsPercent = 100;
    data.commands.fish = { min: 100, max: 100, cooldownMinutes: 60 };
  });
});
after(() => { progressOptions.enabled = false; });

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

async function run(commandName, member, options = {}) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName, options });
  await runWithLocale('en', () => client.commands.get(commandName).execute(interaction, {}, client));
  return interaction.replies.at(-1);
}

const MONDAY = Date.UTC(2026, 9, 26, 10, 0); // Monday 26 Oct 2026, 11:00 in Warsaw
const fixed = (value) => () => value;

test('missions: three a day and three a week, new ones after Warsaw midnight and on Monday', () => {
  const userData = { wallet: 0 };
  const first = ensureMissions(userData, MONDAY, fixed(0));
  assert.equal(first.daily.list.length, 3);
  assert.equal(first.weekly.list.length, 3);
  assert.equal(first.daily.period, '2026-10-26');
  assert.equal(new Set(first.daily.list.map((mission) => mission.id)).size, 3, 'no mission twice');

  // Same Warsaw day (23:30 in Warsaw is 22:30 UTC): nothing changes.
  const late = Date.UTC(2026, 9, 26, 22, 30);
  assert.equal(dayKey(late), '2026-10-26');
  assert.equal(ensureMissions(userData, late, fixed(0.99)).daily.list[0].id, first.daily.list[0].id);

  // After midnight in Warsaw the day changes, the week only on Monday.
  const tuesday = Date.UTC(2026, 9, 26, 23, 5);
  const next = ensureMissions(userData, tuesday, fixed(0.99));
  assert.equal(next.daily.period, '2026-10-27');
  assert.equal(next.weekly.period, weekKey(MONDAY));
  assert.notEqual(next.daily.list[0].id, first.daily.list[0].id);
});

test('a finished mission pays at once; three finished give a free pack; badges pay once', () => {
  const userData = { wallet: 0, missions: {
    daily: { period: '2026-10-26', rerolled: false, bonus: false, list: [
      { id: 'fish', goal: 2, reward: 900, progress: 0, done: false },
      { id: 'work', goal: 1, reward: 450, progress: 0, done: false },
      { id: 'earned', goal: 300, reward: 150, progress: 0, done: false },
    ] },
    weekly: { period: '2026-10-26', rerolled: false, bonus: false, list: [{ id: 'fish', goal: 20, reward: 10000, progress: 0, done: false }] },
  } };

  const one = recordProgress(userData, { fish: 1, earned: 200 }, { settings, now: MONDAY, random: fixed(0) });
  assert.deepEqual(one.missions, []);
  assert.equal(one.achievements.map(({ achievement }) => achievement.id).join(), 'first_fish');
  assert.equal(userData.wallet, 500, 'First catch badge: +500');
  assert.equal(userData.missions.weekly.list[0].progress, 1);

  const two = recordProgress(userData, { fish: 1, earned: 200 }, { settings, now: MONDAY, random: fixed(0) });
  assert.deepEqual(two.missions.map(({ mission }) => mission.id), ['fish', 'earned']);
  assert.equal(userData.wallet, 500 + 900 + 150);
  assert.equal(userData.stats.fish, 2);
  assert.equal(userData.stats.earned, 400);

  const wallet = userData.wallet;
  const three = recordProgress(userData, { work: 1 }, { settings, now: MONDAY, random: fixed(0) });
  assert.equal(three.missions.length, 1);
  assert.equal(three.bonuses.length, 1, 'all three daily missions: a free Starter pack');
  assert.equal(three.bonuses[0].pack.id, 'startowa');
  assert.equal(Object.values(userData.cards).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(userData.wallet, wallet + 450, 'the pack is free');
  assert.equal(userData.stats.missions, 3);

  // Nothing pays twice.
  const again = recordProgress(userData, { work: 5, fish: 0 }, { settings, now: MONDAY, random: fixed(0) });
  assert.deepEqual(again.missions, []);
  assert.deepEqual(again.bonuses, []);
  const embed = progressEmbeds(three, guild.id)[0].toJSON();
  assert.match(embed.description, /Daily mission done/);
  assert.match(embed.description, /All daily missions done/);
  assert.deepEqual(progressEmbeds(again, guild.id), []);
});

test('mission rewards follow the server multiplier, badges too', async () => {
  const doubled = { ...settings, earningsPercent: 200 };
  const userData = { wallet: 0, missions: {
    daily: { period: '2026-10-26', rerolled: false, bonus: true, list: [{ id: 'beg', goal: 1, reward: 250, progress: 0, done: false }] },
    weekly: { period: '2026-10-26', rerolled: false, bonus: true, list: [] },
  } };
  recordProgress(userData, { beg: 1 }, { settings: doubled, now: MONDAY });
  assert.equal(userData.wallet, 500);

  // A badge reached before the stats existed (fish already in /index) is given on the next action.
  const old = { wallet: 0, fishIndex: { bass: 60, tuna: 40 } };
  const result = recordProgress(old, { beg: 1 }, { settings, now: MONDAY });
  assert.deepEqual(result.achievements.map(({ achievement }) => achievement.id), ['first_fish', 'fisher']);
  assert.equal(old.wallet, 5500);
  assert.ok(old.achievements.fisher);
});

test('one free swap a day and one a week, never for a finished mission', () => {
  const userData = { wallet: 0 };
  ensureMissions(userData, MONDAY, fixed(0));
  userData.missions.daily.list[1].done = true;
  assert.equal(rerollMission(userData, 'daily', 1, MONDAY, fixed(0)), null, 'finished missions stay');
  const before = userData.missions.daily.list.map((mission) => mission.id);
  const fresh = rerollMission(userData, 'daily', 0, MONDAY, fixed(0));
  assert.ok(fresh);
  assert.ok(!before.includes(fresh.id), 'the new mission is not one already on the list');
  assert.equal(rerollMission(userData, 'daily', 2, MONDAY, fixed(0)), null, 'one swap a day');
  assert.ok(rerollMission(userData, 'weekly', 0, MONDAY, fixed(0)), 'the weekly swap is separate');
});

test('every mission and badge has a text; badge ids are unique', () => {
  for (const scope of ['daily', 'weekly']) {
    for (const def of MISSIONS[scope]) {
      const text = runWithLocale('pl', () => def.text(def.goal[0], guild.id));
      assert.ok(text.length > 5, `${scope}.${def.id}`);
    }
  }
  assert.equal(new Set(ACHIEVEMENTS.map((achievement) => achievement.id)).size, ACHIEVEMENTS.length);
  for (const achievement of ACHIEVEMENTS) {
    const [current, goal] = achievement.progress({});
    assert.equal(current, 0, achievement.id);
    assert.ok(goal >= 1, achievement.id);
  }
});

test('/fish counts for missions and shows the note; /misje and /osiagniecia show the state', async () => {
  const angler = newMember('Wedkarz');
  await save(angler, { wallet: 0, inventory: { fishing_rod: 1 } });
  const reply = await run('fish', angler);
  assert.equal(reply.embeds.length, 2, 'the fish result and the progress note');
  assert.match(replyText({ replies: [reply] }), /New badge/);
  const account = await data(angler);
  assert.equal(account.stats.fish, 1);
  assert.ok(account.missions.daily.list.length === 3);

  const missions = await run('misje', angler);
  const missionsText = replyText({ replies: [missions] });
  assert.match(missionsText, /Missions of Wedkarz/);
  assert.match(missionsText, /Today/);
  assert.ok(missions.components.length === 1, 'the swap menu');

  const other = newMember('Ciekawski');
  const foreign = await run('misje', other, { osoba: angler.user });
  assert.equal(foreign.components.length, 0, 'someone else\'s missions cannot be swapped');

  const badges = replyText({ replies: [await run('osiagniecia', angler)] });
  // First catch, plus Legend of the seas when that fish was legendary (2%).
  assert.match(badges, /Badges of Wedkarz · [12]\//);
  assert.match(badges, /First catch/);
  assert.match(badges, /Angler/);

  // The swap menu: only the owner, once a day. An unfinished mission (one fish may already finish "catch a rare fish").
  const open = (await data(angler)).missions.daily.list.findIndex((mission) => !mission.done);
  const calls = { reply: [], update: [] };
  const pick = (member) => ({
    id: snowflake(), client, guild, guildId: guild.id, channel, member, user: member.user, values: [`daily.${open}`],
    customId: `misje:zmien:${angler.id}`, replied: false, deferred: false,
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
  });
  await runWithLocale('en', () => missionsMenu.execute(pick(other), client, ['zmien', angler.id]));
  assert.match(calls.reply[0].content, /not your missions/);
  await runWithLocale('en', () => missionsMenu.execute(pick(angler), client, ['zmien', angler.id]));
  assert.match(replyText({ replies: [calls.update[0]] }), /New mission/);
  assert.equal((await data(angler)).missions.daily.rerolled, true);
});

test('panel switches: missions off pay nothing (stats still count), the mission percent scales rewards', () => {
  const missions = () => ({
    daily: { period: '2026-10-26', rerolled: false, bonus: true, list: [{ id: 'heist', goal: 1, reward: 1200, progress: 0, done: false }] },
    weekly: { period: '2026-10-26', rerolled: false, bonus: true, list: [] },
  });
  const off = { wallet: 0, missions: missions() };
  recordProgress(off, { heist: 1 }, { settings: { ...settings, missions: { enabled: false, rewardPercent: 100 } }, now: MONDAY });
  assert.equal(off.wallet, 0);
  assert.equal(off.stats.heist, 1);
  assert.equal(off.missions.daily.list[0].done, false);

  const half = { wallet: 0, missions: missions() };
  recordProgress(half, { heist: 1 }, { settings: { ...settings, missions: { enabled: true, rewardPercent: 50 } }, now: MONDAY });
  assert.equal(half.wallet, 600);
  const none = { wallet: 0, missions: missions() };
  recordProgress(none, { heist: 1 }, { settings: { ...settings, missions: { enabled: true, rewardPercent: 0 } }, now: MONDAY });
  assert.equal(none.wallet, 0);
  assert.equal(none.missions.daily.list[0].done, true);
});
