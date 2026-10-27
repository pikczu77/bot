// /wordle (2026-10-26): one Polish word a day, six guesses, money for solving it, the result
// posted in the channel as squares only.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { getEconomySettings, updateEconomySettings } from '../src/services/economySettings.js';
import { WORDLE_WORDS } from '../src/config/wordleWords.js';
import { GUESS_RE, playGuess, puzzleNumber, scoreGuess, wordOfDay } from '../src/services/wordle.js';
import { dayKey } from '../src/utils/warsawTime.js';
import wordleButton from '../src/interactions/buttons/economy/wordle.js';
import wordleModal from '../src/interactions/modals/economy/wordle.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let settings;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Wordle');
  channel = mockChannel(guild, 'gry');
  settings = await updateEconomySettings(guild.id, (data) => {
    data.currency = { symbol: '$', position: 'left', separator: ',' };
    data.commands.wordle = { reward: 1000 };
  });
});

test('the word list: five Polish letters each, no repeats', () => {
  assert.ok(WORDLE_WORDS.length >= 200);
  for (const word of WORDLE_WORDS) assert.ok(GUESS_RE.test(word), word);
  assert.equal(new Set(WORDLE_WORDS).size, WORDLE_WORDS.length);
});

test('colours: right place, elsewhere, missing; repeated letters count once per letter in the word', () => {
  assert.deepEqual(scoreGuess('kotek', 'kotek'), ['hit', 'hit', 'hit', 'hit', 'hit']);
  assert.deepEqual(scoreGuess('takok', 'kotek'), ['near', 'miss', 'near', 'near', 'hit']);
  assert.deepEqual(scoreGuess('kkkkk', 'kotek'), ['hit', 'miss', 'miss', 'miss', 'hit']);
  assert.deepEqual(scoreGuess('łódka', 'łóżko'), ['hit', 'hit', 'miss', 'hit', 'miss']);
  assert.deepEqual(scoreGuess('lampa', 'pasta'), ['miss', 'hit', 'miss', 'near', 'hit']);
});

test('a new word every Warsaw day, different on another server, no repeat for the whole list', () => {
  const days = Array.from({ length: WORDLE_WORDS.length }, (_, index) => dayKey(Date.UTC(2026, 9, 28, 12) + index * 86_400_000));
  const words = days.map((day) => wordOfDay(guild.id, day));
  assert.equal(new Set(words).size, WORDLE_WORDS.length);
  // Days before the list grew keep their words (the first 243, the same walk as before).
  const first = WORDLE_WORDS.slice(0, 243);
  const salt = [...String(guild.id)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 1_000_003, 0);
  assert.equal(wordOfDay(guild.id, '2026-10-27'), first[(97 + salt) % 243]);
  assert.equal(wordOfDay(guild.id, '2026-10-26'), first[salt % 243]);
  assert.equal(puzzleNumber('2026-10-26'), 1);
  assert.equal(puzzleNumber('2026-10-27'), 2);
  const other = days.slice(0, 10).map((day) => wordOfDay('999999999999999999', day));
  assert.notDeepEqual(other, words.slice(0, 10));
});

test('rewards by guesses, one game a day, streaks', () => {
  const day1 = Date.UTC(2026, 9, 26, 12);
  const answer = wordOfDay(guild.id, dayKey(day1));
  const wrong = WORDLE_WORDS.find((word) => word !== answer && [...word].every((letter) => !answer.includes(letter))) ?? 'xxxxx';
  const member = { wallet: 0 };

  assert.equal(playGuess({ userData: member, guildId: guild.id, settings, text: 'abc', now: day1 }).error, 'format');
  assert.equal(playGuess({ userData: member, guildId: guild.id, settings, text: wrong, now: day1 }).finished, false);
  const win = playGuess({ userData: member, guildId: guild.id, settings, text: answer.toUpperCase(), now: day1 });
  assert.equal(win.solved, true);
  assert.equal(win.reward, 850, 'second guess: 85% of 1,000');
  assert.equal(member.wallet, 850);
  assert.equal(member.wordle.streak, 1);
  assert.equal(playGuess({ userData: member, guildId: guild.id, settings, text: answer, now: day1 }).error, 'done');

  // Next day: solved again, the streak grows; a lost game resets it.
  const day2 = day1 + 86_400_000;
  const second = playGuess({ userData: member, guildId: guild.id, settings, text: wordOfDay(guild.id, dayKey(day2)), now: day2 });
  assert.equal(second.reward, 1000, 'first guess pays everything');
  assert.equal(member.wordle.streak, 2);
  const day3 = day2 + 86_400_000;
  const answer3 = wordOfDay(guild.id, dayKey(day3));
  const miss = WORDLE_WORDS.find((word) => word !== answer3);
  let last;
  for (let index = 0; index < 6; index += 1) last = playGuess({ userData: member, guildId: guild.id, settings, text: miss, now: day3 });
  assert.equal(last.finished, true);
  assert.equal(last.solved, false);
  assert.equal(member.wordle.streak, 0);
  assert.equal(member.wallet, 1850);
});

test('/wordle: private board, the guess form, the result in the channel without letters', async () => {
  const player = mockMember(guild, mockUser('Zgadywacz'));
  await setEconomyData(client, guild.id, player.id, { ...(await getEconomyData(client, guild.id, player.id)), wallet: 0, wordle: null });
  const interaction = mockInteraction({ client, guild, channel, member: player, commandName: 'wordle' });
  await runWithLocale('en', () => client.commands.get('wordle').execute(interaction, {}, client));
  const board = interaction.replies.at(-1);
  assert.match(replyText({ replies: [board] }), /Wordle #\d+/);
  assert.match(replyText({ replies: [board] }), /Guesses left: \*\*6\*\*/);
  const buttonId = board.components[0].toJSON().components[0].custom_id;
  assert.equal(buttonId, `wordle:zgaduj:${player.id}`);

  const shown = [];
  const other = mockMember(guild, mockUser('Inny'));
  const press = (member) => ({
    id: snowflake(), client, guild, guildId: guild.id, channel, member, user: member.user, customId: buttonId,
    reply: async (payload) => { shown.push({ reply: payload }); },
    showModal: async (modal) => { shown.push({ modal: modal.toJSON() }); },
  });
  await runWithLocale('en', () => wordleButton.execute(press(other), client, ['zgaduj', player.id]));
  assert.match(shown[0].reply.content, /your own game/);
  await runWithLocale('en', () => wordleButton.execute(press(player), client, ['zgaduj', player.id]));
  assert.equal(shown[1].modal.custom_id, `wordle:odp:${player.id}`);

  const answer = wordOfDay(guild.id, dayKey());
  const updates = [];
  const submit = (text) => ({
    id: snowflake(), client, guild, guildId: guild.id, channel, member: player, user: player.user, customId: `wordle:odp:${player.id}`,
    fields: { getTextInputValue: () => text },
    isFromMessage: () => true,
    update: async (payload) => { updates.push(payload); },
    reply: async (payload) => { updates.push(payload); },
  });
  await runWithLocale('en', () => wordleModal.execute(submit('ab1'), client, ['odp', player.id]));
  assert.match(replyText({ replies: [updates.at(-1)] }), /exactly 5 letters/);
  const before = channel.sent.length;
  await runWithLocale('en', () => wordleModal.execute(submit(answer), client, ['odp', player.id]));
  assert.match(replyText({ replies: [updates.at(-1)] }), /You get \*\*\$1,000\*\*/);
  assert.equal(updates.at(-1).components.length, 0, 'no more guessing today');
  assert.equal(channel.sent.length, before + 1);
  const post = channel.sent.at(-1).embeds[0].toJSON().description;
  assert.match(post, /Zgadywacz\*\* played Wordle #\d+: \*\*1\/6\*\*/);
  assert.ok(!post.toLowerCase().includes(answer), 'the channel never sees the word');
  assert.equal((await getEconomyData(client, guild.id, player.id)).wallet, 1000);
  assert.equal((await getEconomySettings(guild.id)).commands.wordle.reward, 1000);
});
