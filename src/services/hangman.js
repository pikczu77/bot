// hangman.js — /wisielec: hangman for money on a channel (2026-11-01, owner picked the idea from my list).
//
// A member starts a game; anyone on the channel picks letters from two menus or tries the whole password in a form.
// Seven lives: a wrong letter or a wrong password takes one, and a wrong password also ends that member's password
// tries in this game (no brute force). Whoever finishes the password wins commands.hangman.reward scaled by the lives
// left (REWARD_FLOOR ... 100%), the server multiplier, Fortune and a "kasa" event. One game at a time per server. Starting
// has a break per member (commands.hangman.cooldownMinutes, Stamina shortens it). IDLE_MS without a move ends the game.
//
// Store guild:{id}:hangman = { recent: [indexes of HANGMAN_WORDS] }. Member data: lastHangman.
// The running game lives in memory; after a restart its menus say it is over (same as the quiz).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { HANGMAN_WORDS } from '../config/hangmanWords.js';
import { createEmbed, formatDuration } from '../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { guildStore, userError } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import { cooldownMs, getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { staminaCooldown, withEconomyLock } from './economyUpgrades.js';
import { progressEmbeds, recordProgress } from './progress.js';
import { addSeasonReward, noteSeasonGifts, seasonGiftText } from './seasonalEvents.js';

export const MAX_LIVES = 7;
export const IDLE_MS = 3 * 60_000;
export const PASSWORD_MAX = 60;
const REWARD_FLOOR = 0.4;
const RECENT_LIMIT = 80;

export const LETTERS = Object.freeze([...'aąbcćdeęfghijklłmnńoóprsśtuwyzźż']);
const LETTER_SET = new Set(LETTERS);
const SECOND_MENU_FROM = LETTERS.indexOf('m');
const PLAIN = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

const GALLOWS = [
  ['', '', ''], ['O', '', ''], ['O', '|', ''], ['O', '/|', ''], ['O', '/|\\', ''], ['O', '/|\\', '/'], ['O', '/|\\', '/ \\'], ['X', '/|\\', '/ \\'],
];

const store = guildStore('hangman', { recent: [] });
const running = new Map(); // guildId -> game

export const runningGame = (guildId) => running.get(guildId) ?? null;
export const isPasswordLetter = (char) => LETTER_SET.has(char);
const upper = (text) => text.toLocaleUpperCase('pl');
const normalize = (text) => String(text ?? '').trim().toLocaleLowerCase('pl').replace(/\s+/g, ' ');
/** Without Polish letters: on a phone nobody should lose a life over "zolw". Letters from the menus stay exact. */
const plain = (text) => [...normalize(text)].map((char) => PLAIN[char] ?? char).join('');

/** A password not used lately. */
export function pickWord(recent = [], random = Math.random) {
  const fresh = HANGMAN_WORDS.map((_, index) => index).filter((index) => !recent.includes(index));
  const pool = fresh.length ? fresh : HANGMAN_WORDS.map((_, index) => index);
  return pool[Math.floor(random() * pool.length)];
}

/** The password as shown: guessed letters, `_` for the others, wider gaps between words. */
export function maskedWord(word, guessed, reveal = false) {
  return [...word].map((char) => {
    if (char === ' ') return ' ';
    return reveal || !isPasswordLetter(char) || guessed.has(char) ? upper(char) : '_';
  }).join(' ');
}

export const isSolved = (game) => [...game.word].every((char) => !isPasswordLetter(char) || game.guessed.has(char));

/** Prize before the server multiplier and Fortune: all of it with every life left, REWARD_FLOOR with the last one. */
export const rewardFor = (reward, lives) => Math.round((Number(reward) || 0) * (REWARD_FLOOR + (1 - REWARD_FLOOR) * Math.max(0, lives - 1) / (MAX_LIVES - 1)));

/** One letter. Mutates the game. */
export function guessLetter(game, letter) {
  if (!isPasswordLetter(letter) || game.guessed.has(letter)) return { error: 'used' };
  game.guessed.add(letter);
  const hit = [...game.word].includes(letter);
  if (!hit) {
    game.wrong.push(letter);
    game.lives -= 1;
  }
  return { hit, solved: isSolved(game), lost: game.lives <= 0 };
}

/** The whole password. Mutates the game. A wrong try takes a life and ends this member's tries. */
export function guessPassword(game, userId, text) {
  if (game.passwordTried.has(userId)) return { error: 'tried' };
  const hit = plain(text) === plain(game.word);
  if (hit) {
    for (const char of game.word) if (isPasswordLetter(char)) game.guessed.add(char);
    return { hit: true, solved: true, lost: false };
  }
  game.passwordTried.add(userId);
  game.lives -= 1;
  return { hit: false, solved: false, lost: game.lives <= 0 };
}

function gallowsText(lives) {
  const [head, body, legs] = GALLOWS[MAX_LIVES - lives];
  return [' +---+', ' |   |', ` |   ${head}`, ` |  ${body.padStart(2)}`, ` |  ${legs}`, '======'].join('\n');
}

function gameEmbed(game, { notice = '', color = '#5865F2', reveal = false, footer = '' } = {}) {
  const wrong = game.wrong.map(upper).join(' ');
  const lines = [
    `\`\`\`\n${gallowsText(game.lives)}\n\n${maskedWord(game.word, game.guessed, reveal)}\n\`\`\``,
    t`❤️ Lives: **${game.lives}/${MAX_LIVES}**` + (wrong ? t` · not in the password: **${wrong}**` : ''),
    notice,
  ].filter(Boolean);
  return createEmbed({ title: t`🪢 Hangman · ${game.category}`, description: lines.join('\n'), color, footer: false })
    .setFooter({ text: footer || t`Pick a letter · the one who finishes the password wins · ends after ${Math.round(IDLE_MS / 60_000)} min without a move` });
}

function letterMenu(game, letters, placeholder, part) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`wisielec:litera:${game.id}:${part}`)
    .setPlaceholder(placeholder)
    .addOptions(letters.map((letter) => ({ label: upper(letter), value: letter }))));
}

function gameComponents(game) {
  const left = (from, to) => LETTERS.slice(from, to).filter((letter) => !game.guessed.has(letter));
  const first = left(0, SECOND_MENU_FROM);
  const second = left(SECOND_MENU_FROM);
  return [
    ...(first.length ? [letterMenu(game, first, t`Letters ${upper(first[0])} - ${upper(first.at(-1))}`, 1)] : []),
    ...(second.length ? [letterMenu(game, second, t`Letters ${upper(second[0])} - ${upper(second.at(-1))}`, 2)] : []),
    new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`wisielec:haslo:${game.id}`)
      .setLabel(t('I know the password'))
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary)),
  ];
}

const openPayload = (game, notice = '') => ({ embeds: [gameEmbed(game, { notice })], components: gameComponents(game), allowedMentions: { parse: [] } });

function armTimer(game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(() => expireGame(game.guildId, game.id).catch((error) => logger.warn(`Hangman end failed: ${error.message}`)), IDLE_MS);
  game.timer.unref?.();
}

function endGame(game) {
  clearTimeout(game.timer);
  if (running.get(game.guildId)?.id === game.id) running.delete(game.guildId);
}

/** IDLE_MS without a move: show the password. */
export async function expireGame(guildId, gameId) {
  const game = running.get(guildId);
  if (!game || game.id !== gameId) return false;
  endGame(game);
  await game.message?.edit({
    embeds: [gameEmbed(game, { reveal: true, color: '#8E8E93', notice: t('⏰ Nobody finished it in time.'), footer: t('Start a new game with /wisielec') })],
    components: [],
  }).catch((error) => logger.warn(`Hangman message not edited: ${error.message}`));
  return true;
}

/** /wisielec: post a new game on `channel`. Throws a user error when one runs or the member's break is not over. */
export async function startGame({ client, guild, channel, user, now = Date.now(), random = Math.random }) {
  const current = runningGame(guild.id);
  if (current) throw userError(t`A game is already running in <#${current.channelId}>. Join it!`);

  return withEconomyLock(guild.id, user.id, async () => {
    const settings = await getEconomySettings(guild.id);
    const userData = await getEconomyData(client, guild.id, user.id);
    const left = (Number(userData.lastHangman) || 0) + staminaCooldown(userData, cooldownMs(settings.commands.hangman.cooldownMinutes)) - now;
    if (left > 0) throw userError(t`You can start another game in **${formatDuration(left)}**. You can still play in a game someone else starts.`);
    const { recent } = await store.get(guild.id);
    if (runningGame(guild.id)) throw userError(t('A game has just started. Join it!'));
    const index = pickWord(recent, random);
    const { word, category } = HANGMAN_WORDS[index];
    const game = {
      id: now.toString(36), guildId: guild.id, channelId: channel.id, word, category,
      guessed: new Set(), wrong: [], lives: MAX_LIVES, passwordTried: new Set(), startedBy: user.id,
    };
    running.set(guild.id, game);
    try {
      game.message = await channel.send(openPayload(game));
    } catch (error) {
      running.delete(guild.id);
      throw error;
    }
    armTimer(game);
    userData.lastHangman = now;
    await setEconomyData(client, guild.id, user.id, userData);
    await store.update(guild.id, (stored) => { stored.recent = [...(stored.recent ?? []), index].slice(-RECENT_LIMIT); });
    return game;
  });
}

async function payWinner(client, guild, game, user) {
  return withEconomyLock(guild.id, user.id, async () => {
    const settings = await getEconomySettings(guild.id);
    const userData = await getEconomyData(client, guild.id, user.id);
    const prize = scaleEarnings(settings, rewardFor(settings.commands.hangman.reward, game.lives), userData);
    userData.wallet = (Number(userData.wallet) || 0) + prize;
    const progress = recordProgress(userData, { hangman: 1 }, { settings });
    // Holiday events: a won game also gives the event currency (services/seasonalEvents.js).
    const gifts = await addSeasonReward(guild.id, userData, 'game');
    await setEconomyData(client, guild.id, user.id, userData);
    await noteSeasonGifts(guild.id, user.id, gifts);
    return { prize, progress, gifts };
  });
}

/** What the channel sees after a move. */
async function afterMove({ client, guild, game, user, result, notice }) {
  if (result.solved) {
    endGame(game);
    const { prize, progress, gifts } = await payWinner(client, guild, game, user);
    const gift = gifts.length ? ` · ${seasonGiftText(gifts)}` : '';
    return {
      update: {
        embeds: [
          gameEmbed(game, { reveal: true, color: '#30D158', notice: t`🎉 **${user.username}** finished it: **+${money(guild.id, prize)}**` + gift, footer: t('Start a new game with /wisielec') }),
          ...progressEmbeds(progress, guild.id),
        ],
        components: [],
        allowedMentions: { parse: [] },
      },
    };
  }
  if (result.lost) {
    endGame(game);
    return {
      update: {
        embeds: [gameEmbed(game, { reveal: true, color: '#FF453A', notice: t('💀 No lives left. Nobody wins.'), footer: t('Start a new game with /wisielec') })],
        components: [],
        allowedMentions: { parse: [] },
      },
    };
  }
  armTimer(game);
  return { update: openPayload(game, notice) };
}

/** A letter from a menu. Returns { update } (new message) or { reply } (private answer). */
export async function playLetter({ client, guild, user, gameId, letter }) {
  const game = runningGame(guild.id);
  if (!game || game.id !== gameId) return { reply: t('This game is over. Start a new one with `/wisielec`.') };
  const result = guessLetter(game, letter);
  if (result.error) return { reply: t('Someone has just used that letter. Pick another one.') };
  const shown = upper(letter);
  const notice = result.hit ? t`✅ **${user.username}**: **${shown}** is in the password.` : t`❌ **${user.username}**: no **${shown}**.`;
  return afterMove({ client, guild, game, user, result, notice });
}

/** The whole password from the form. Returns { update } or { reply }. */
export async function playPassword({ client, guild, user, gameId, text }) {
  const game = runningGame(guild.id);
  if (!game || game.id !== gameId) return { reply: t('This game is over. Start a new one with `/wisielec`.') };
  const result = guessPassword(game, user.id, text);
  if (result.error) return { reply: t('You already tried the password in this game. You can still pick letters.') };
  return afterMove({ client, guild, game, user, result, notice: t`❌ **${user.username}** tried the password and lost a life.` });
}

export function passwordModal(gameId) {
  return new ModalBuilder()
    .setCustomId(`wisielec:odp:${gameId}`)
    .setTitle(t('Hangman'))
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('haslo')
      .setLabel(t('The whole password (a wrong one costs a life)'))
      .setStyle(TextInputStyle.Short)
      .setMaxLength(PASSWORD_MAX)
      .setRequired(true)));
}

/** For tests: forget a running game. */
export function clearGame(guildId) {
  const game = running.get(guildId);
  if (game) endGame(game);
}
