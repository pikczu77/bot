// duel.js — /pojedynek: rock, paper, scissors for money between two members (2026-10-26, owner: "klasa").
//
//   pojedynek:ok:<id>         the challenged member accepts (only them)
//   pojedynek:nie:<id>        the challenged member declines; the author can withdraw with the same button
//   pojedynek:pick:<id>:<r|p|s>  each player picks privately; the result comes when both picked
// No money is held during the duel: the loser pays the stake (cash first, then bank, at most what they
// have) when it is decided. A tie means another round (at most MAX_TIES, then nobody pays). Nobody picks
// within PICK_MS: the one who picked wins, nobody picked = nothing happens. Duels live in memory.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { getEconomySettings, money } from '../../../services/economySettings.js';
import { spendMoney, withEconomyLock } from '../../../services/economyUpgrades.js';
import { assertNotJailed } from '../../../services/economyJail.js';
import { progressEmbeds, recordProgress } from '../../../services/progress.js';
import { t } from '../../../i18n/index.js';

export const INVITE_MS = 2 * 60_000;
export const PICK_MS = 60_000;
export const MAX_TIES = 3;
export const MIN_STAKE = 50;
export const MOVES = { r: { emoji: '✊', name: t('rock') }, p: { emoji: '✋', name: t('paper') }, s: { emoji: '✌️', name: t('scissors') } };
const BEATS = { r: 's', p: 'r', s: 'p' };

const duels = new Map(); // id -> duel
let lastId = 0;

const wealth = (userData) => Math.max(0, Math.floor(userData.wallet || 0)) + Math.max(0, Math.floor(userData.bank || 0));
const userErr = (text) => createError('Duel not possible', ErrorTypes.VALIDATION, text, { expected: true });

/** 'a' / 'b' / null (tie). */
export const winnerOf = (a, b) => (a === b ? null : BEATS[a] === b ? 'a' : 'b');

function inviteButtons(id) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pojedynek:ok:${id}`).setLabel(t('Accept')).setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pojedynek:nie:${id}`).setLabel(t('Decline')).setStyle(ButtonStyle.Secondary),
  )];
}

function pickButtons(id, disabled = false) {
  return [new ActionRowBuilder().addComponents(Object.entries(MOVES).map(([key, move]) => new ButtonBuilder()
    .setCustomId(`pojedynek:pick:${id}:${key}`).setEmoji(move.emoji).setStyle(ButtonStyle.Primary).setDisabled(disabled)))];
}

const title = (duel) => t`⚔️ Duel: ${duel.aName} vs ${duel.bName}`;

async function checkPlayer(client, guildId, userId, name, stake, now) {
  const settings = await getEconomySettings(guildId);
  const userData = await getEconomyData(client, guildId, userId);
  assertNotJailed(userData, now, { settings, guildId });
  if (wealth(userData) < stake) throw userErr(t`${name} does not have ${money(guildId, stake)} (cash and bank).`);
  return settings;
}

/** /pojedynek: check both players and post the challenge. */
export async function createDuel({ client, guildId, challenger, opponent, stake, now = Date.now() }) {
  if (opponent.bot || opponent.id === challenger.id) throw userErr(t('Pick another member to duel.'));
  if (!(stake >= MIN_STAKE)) throw userErr(t`The lowest stake is ${money(guildId, MIN_STAKE)}.`);
  const settings = await checkPlayer(client, guildId, challenger.id, challenger.username, stake, now);
  const maxBet = settings.commands.gamble.maxBet;
  if (maxBet > 0 && stake > maxBet) throw userErr(t`The highest stake on this server is ${money(guildId, maxBet)}.`);
  await checkPlayer(client, guildId, opponent.id, opponent.username, stake, now);

  for (const [id, duel] of duels) if (now - duel.createdAt > INVITE_MS + PICK_MS * (MAX_TIES + 1)) duels.delete(id);
  lastId = (lastId + 1) % 1_000_000;
  const id = `${now.toString(36)}${lastId.toString(36)}`;
  const duel = { id, guildId, a: challenger.id, b: opponent.id, aName: challenger.username, bName: opponent.username, stake, createdAt: now, state: 'invite', picks: {}, ties: 0 };
  duels.set(id, duel);
  return {
    content: `<@${opponent.id}>`,
    embeds: [createEmbed({
      title: title(duel),
      description: t`**${challenger.username}** challenges **${opponent.username}** to rock, paper, scissors for **${money(guildId, stake)}**.\nThe loser pays the winner. Accept <t:${Math.floor((now + INVITE_MS) / 1000)}:R>.`,
      color: '#5865F2',
      footer: false,
    })],
    components: inviteButtons(id),
    allowedMentions: { users: [opponent.id] },
  };
}

export const getDuel = (id) => duels.get(id) ?? null;

function pickView(duel, note = '') {
  const status = (userId, name) => `${duel.picks[userId] ? '✅' : '⏳'} ${name}`;
  return {
    content: '',
    embeds: [createEmbed({
      title: title(duel),
      description: [note, t`Stake: **${money(duel.guildId, duel.stake)}**. Pick a move - nobody sees it until both picked.`,
        `${status(duel.a, duel.aName)}\n${status(duel.b, duel.bName)}`,
        t`Time: <t:${Math.floor(duel.pickUntil / 1000)}:R>`].filter(Boolean).join('\n\n'),
      color: '#5865F2',
      footer: false,
    })],
    components: pickButtons(duel.id),
  };
}

/** The challenged member accepts: both are checked again, the picking starts. */
export async function acceptDuel({ client, duel, now = Date.now() }) {
  if (now - duel.createdAt > INVITE_MS) {
    duels.delete(duel.id);
    return { content: '', embeds: [createEmbed({ title: title(duel), description: t('The challenge has expired.'), color: '#8E8E93', footer: false })], components: [] };
  }
  await checkPlayer(client, duel.guildId, duel.a, duel.aName, duel.stake, now);
  await checkPlayer(client, duel.guildId, duel.b, duel.bName, duel.stake, now);
  duel.state = 'pick';
  duel.pickUntil = now + PICK_MS;
  return pickView(duel);
}

export function closeDuel(duel, byAuthor) {
  duels.delete(duel.id);
  return {
    content: '',
    embeds: [createEmbed({ title: title(duel), description: byAuthor ? t('The challenge was withdrawn.') : t('The challenge was declined.'), color: '#8E8E93', footer: false })],
    components: [],
  };
}

function withBothLocks(guildId, first, second, task) {
  const [x, y] = [first, second].sort();
  return withEconomyLock(guildId, x, () => withEconomyLock(guildId, y, task));
}

/** The loser pays the winner (at most what the loser has). Returns { paid, progress: [winner, loser] }. */
async function settle(client, duel, winnerId, loserId, now) {
  return withBothLocks(duel.guildId, winnerId, loserId, async () => {
    const settings = await getEconomySettings(duel.guildId);
    const winner = await getEconomyData(client, duel.guildId, winnerId, { joint: false });
    const loser = await getEconomyData(client, duel.guildId, loserId, { joint: false });
    const paid = Math.min(duel.stake, wealth(loser));
    spendMoney(loser, paid);
    winner.wallet = (Number(winner.wallet) || 0) + paid;
    const progress = [
      recordProgress(winner, { duel: 1, duelWin: 1 }, { settings, now }),
      recordProgress(loser, { duel: 1 }, { settings, now }),
    ];
    await setEconomyData(client, duel.guildId, winnerId, winner);
    await setEconomyData(client, duel.guildId, loserId, loser);
    return { paid, progress };
  });
}

/**
 * A pick. Returns { reply } (private answer) or { update } (new message) when both picked.
 */
export async function pickMove({ client, duel, userId, move, now = Date.now() }) {
  if (duel.state !== 'pick' || ![duel.a, duel.b].includes(userId)) return { reply: t('This duel is not yours.') };
  if (!MOVES[move]) return { reply: t('Pick rock, paper or scissors.') };
  if (duel.picks[userId]) return { reply: t`You already picked ${MOVES[duel.picks[userId]].emoji}.` };
  duel.picks[userId] = move;
  if (!(duel.picks[duel.a] && duel.picks[duel.b])) return { reply: t`You picked ${MOVES[move].emoji}. Waiting for the other player.`, refresh: pickView(duel) };

  const a = duel.picks[duel.a];
  const b = duel.picks[duel.b];
  const shown = `${duel.aName} ${MOVES[a].emoji} ${t('vs')} ${MOVES[b].emoji} ${duel.bName}`;
  const winner = winnerOf(a, b);
  if (!winner) {
    duel.ties += 1;
    if (duel.ties >= MAX_TIES) {
      duels.delete(duel.id);
      return { update: { content: '', embeds: [createEmbed({ title: title(duel), description: `${shown}\n\n${t`${MAX_TIES} ties in a row - nobody pays.`}`, color: '#8E8E93', footer: false })], components: [] } };
    }
    duel.picks = {};
    duel.pickUntil = now + PICK_MS;
    return { update: pickView(duel, t`${shown} - tie! Another round.`) };
  }
  return finish(client, duel, winner === 'a' ? duel.a : duel.b, shown, now);
}

async function finish(client, duel, winnerId, shown, now) {
  duels.delete(duel.id);
  const loserId = winnerId === duel.a ? duel.b : duel.a;
  const winnerName = winnerId === duel.a ? duel.aName : duel.bName;
  const { paid, progress } = await settle(client, duel, winnerId, loserId, now);
  return {
    update: {
      content: '',
      embeds: [
        createEmbed({ title: title(duel), description: `${shown}\n\n${t`🏆 **${winnerName}** wins **${money(duel.guildId, paid)}**!`}`, color: '#30D158', footer: false }),
        ...progressEmbeds(progress[0], duel.guildId),
      ],
      components: [],
    },
  };
}

/** Time is up while picking: the one who picked wins; nobody picked = no money moves. Returns the update or null. */
export async function timeoutDuel({ client, duel, now = Date.now() }) {
  if (duel.state !== 'pick' || now < duel.pickUntil) return null;
  const picked = [duel.a, duel.b].filter((id) => duel.picks[id]);
  if (picked.length !== 1) {
    duels.delete(duel.id);
    return { content: '', embeds: [createEmbed({ title: title(duel), description: t('Nobody picked in time - nobody pays.'), color: '#8E8E93', footer: false })], components: [] };
  }
  return (await finish(client, duel, picked[0], t('The other player did not pick in time.'), now)).update;
}
