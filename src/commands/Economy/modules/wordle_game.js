// wordle_game.js — views and actions of /wordle (rules: services/wordle.js).
//   wordle:zgaduj:<ownerId>  button under the private board: opens the guess form
//   wordle:odp:<ownerId>     the guess form (modal)
// The board is private; a finished game is also posted in the channel as coloured squares only.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { getEconomySettings, money, scaleEarnings } from '../../../services/economySettings.js';
import { withEconomyLock } from '../../../services/economyUpgrades.js';
import { progressEmbeds, recordProgress } from '../../../services/progress.js';
import { nextMidnight } from '../../../utils/warsawTime.js';
import {
  MAX_GUESSES, REWARD_FACTORS, WORD_LENGTH, playGuess, puzzleNumber, scoreGuess, squares, todaysGame, wordOfDay,
} from '../../../services/wordle.js';
import { t } from '../../../i18n/index.js';

export const WORDLE_MODAL = 'wordle';
const RANK = { miss: 0, near: 1, hit: 2 };
const upper = (word) => word.toLocaleUpperCase('pl');

/** Best colour of every letter guessed so far. */
function letterStates(guesses, answer) {
  const states = new Map();
  for (const guess of guesses) {
    const score = scoreGuess(guess, answer);
    [...guess].forEach((letter, index) => {
      if (!states.has(letter) || RANK[score[index]] > RANK[states.get(letter)]) states.set(letter, score[index]);
    });
  }
  return states;
}

function boardLines(guesses, answer) {
  const rows = guesses.map((guess) => `${squares(scoreGuess(guess, answer))}  \`${upper(guess).split('').join(' ')}\``);
  while (rows.length < MAX_GUESSES) rows.push('⬜⬜⬜⬜⬜');
  return rows.join('\n');
}

/** The private board of a member. */
export function buildBoard({ guildId, settings, game, notice = '', ownerId }) {
  const answer = wordOfDay(guildId, game.day);
  const left = MAX_GUESSES - game.guesses.length;
  const states = letterStates(game.guesses, answer);
  const group = (state) => [...states].filter(([, value]) => value === state).map(([letter]) => upper(letter)).sort((a, b) => a.localeCompare(b, 'pl')).join(' ');
  const next = scaleEarnings(settings, Math.round((Number(settings.commands.wordle?.reward) || 0) * (REWARD_FACTORS[game.guesses.length] ?? 0)));

  const lines = [notice, boardLines(game.guesses, answer)].filter(Boolean);
  const embed = createEmbed({
    title: t`🟩 Wordle #${puzzleNumber(game.day)}`,
    description: lines.join('\n\n'),
    color: game.solved ? '#30D158' : game.done ? '#FF453A' : '#5865F2',
    footer: false,
  });
  if (states.size) {
    const known = [
      group('hit') && `🟩 ${group('hit')}`,
      group('near') && `🟨 ${group('near')}`,
      group('miss') && `⬛ ${group('miss')}`,
    ].filter(Boolean).join('\n');
    embed.addFields({ name: t('Letters'), value: known });
  }
  if (game.done) {
    embed.addFields({
      name: game.solved ? t('Solved!') : t`The word was ${upper(answer)}`,
      value: t`New word <t:${Math.floor(nextMidnight() / 1000)}:R>. Streak: **${game.streak}**`,
    });
  } else {
    embed.addFields({ name: t('Rules'), value: t`A ${WORD_LENGTH}-letter Polish word. 🟩 right place · 🟨 in the word elsewhere · ⬛ not in the word.\nGuesses left: **${left}** · a hit now pays **${money(guildId, next)}**` });
  }
  const components = game.done ? [] : [new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`wordle:zgaduj:${ownerId}`)
    .setLabel(t('Guess'))
    .setEmoji('✏️')
    .setStyle(ButtonStyle.Primary))];
  return { embeds: [embed], components };
}

/** /wordle: today's board of the member. */
export async function showWordle({ client, guildId, user }) {
  const settings = await getEconomySettings(guildId);
  const userData = await getEconomyData(client, guildId, user.id);
  return buildBoard({ guildId, settings, game: todaysGame(userData), ownerId: user.id });
}

export function guessModal(ownerId) {
  return new ModalBuilder()
    .setCustomId(`${WORDLE_MODAL}:odp:${ownerId}`)
    .setTitle(t('Wordle'))
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('slowo')
      .setLabel(t('Your word (5 letters)'))
      .setStyle(TextInputStyle.Short)
      .setMinLength(WORD_LENGTH)
      .setMaxLength(WORD_LENGTH)
      .setRequired(true)));
}

/** "🟩 Anna solved Wordle #3 in 4/6" with the squares, for the channel. */
function publicResult({ user, game, guildId }) {
  const answer = wordOfDay(guildId, game.day);
  const grid = game.guesses.map((guess) => squares(scoreGuess(guess, answer))).join('\n');
  const score = game.solved ? `${game.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return {
    embeds: [createEmbed({
      description: `${t`**${user.username}** played Wordle #${puzzleNumber(game.day)}: **${score}**`}${game.streak > 1 ? t` · streak ${game.streak} 🔥` : ''}\n${grid}`,
      color: game.solved ? '#30D158' : '#8E8E93',
      footer: false,
    })],
    allowedMentions: { parse: [] },
  };
}

/**
 * One guess from the form. Returns { board, publicPost } where publicPost is set when the game ended.
 */
export function submitGuess({ client, guildId, user, text }) {
  return withEconomyLock(guildId, user.id, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const result = playGuess({ userData, guildId, settings, text });
    if (result.error) {
      const notice = result.error === 'done'
        ? t('You already played today. Come back tomorrow!')
        : t`❌ Type exactly ${WORD_LENGTH} letters (Polish letters are fine).`;
      return { board: buildBoard({ guildId, settings, game: result.game, notice, ownerId: user.id }) };
    }

    let progress = null;
    if (result.finished) {
      progress = recordProgress(userData, {
        wordle: result.solved ? 1 : 0,
        wordleGuesses: result.solved ? result.game.guesses.length : 0,
        wordleStreak: result.game.streak,
      }, { settings });
    }
    await setEconomyData(client, guildId, user.id, userData);

    const notice = result.solved
      ? t`🎉 **${upper(result.answer)}**! You get **${money(guildId, result.reward)}**.`
      : result.finished ? t('No more guesses for today.') : '';
    const board = buildBoard({ guildId, settings, game: result.game, notice, ownerId: user.id });
    board.embeds.push(...progressEmbeds(progress, guildId));
    return { board, publicPost: result.finished ? publicResult({ user, game: result.game, guildId }) : null };
  });
}
