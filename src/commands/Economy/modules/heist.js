// heist.js — /napad: a team heist (2026-10-26, owner picked idea 9: "before the heist starts you can invite someone").
//
// The leader opens a lobby in the channel with buttons (interactions/buttons/economy/heist.js):
//   napad:dolacz:<id>   join (an invite-only lobby takes only invited members)
//   napad:zapros:<id>   leader: a private member picker (interactions/selectMenus/economy/heist.js, napad:kogo:<id>);
//                       the invited are pinged in the channel
//   napad:start:<id>    leader: start once the crew is big enough
//   napad:wyjdz:<id>    leave; the leader cancels the lobby
// At the start everyone pays the gear price (cash first, then bank) and gets the break. One roll decides for the whole
// crew: every member gets the loot per person (x Street smarts, server multiplier, Fortune), or everyone goes to jail.
// More people = a bigger chance. Lobbies live in memory for LOBBY_TTL_MS (a restart ends them).
// Accounts are read without the joint bank of a marriage, like /wymiana.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { cooldownMs, getEconomySettings, money, scaleEarnings } from '../../../services/economySettings.js';
import { earningMultiplier, spendMoney, staminaCooldown, withEconomyLock } from '../../../services/economyUpgrades.js';
import { jailTimeLeft } from '../../../services/economyJail.js';
import { progressEmbeds, recordProgress } from '../../../services/progress.js';
import { logger } from '../../../utils/logger.js';
import { t, tr } from '../../../i18n/index.js';

// loot = per member before bonuses; chance = with the smallest crew, +CREW_BONUS for every extra member.
export const HEIST_TARGETS = Object.freeze([
  { id: 'sklep', emoji: '🏪', name: t('Corner shop'), minCrew: 1, chance: 55, loot: [2_000, 4_000], gear: 500 },
  { id: 'kantor', emoji: '💱', name: t('Currency exchange'), minCrew: 2, chance: 45, loot: [5_000, 9_000], gear: 1_500 },
  { id: 'bank', emoji: '🏦', name: t('Club bank'), minCrew: 3, chance: 35, loot: [12_000, 22_000], gear: 4_000 },
]);
export const MAX_CREW = 5;
export const MAX_INVITES = 4;
export const CREW_BONUS = 8;
export const MAX_CHANCE = 85;
export const LOBBY_TTL_MS = 5 * 60 * 1000;
/** Pause before the result shows; tests set it to 0. */
export const heistTiming = { suspenseMs: 2500 };

export const getTarget = (id) => HEIST_TARGETS.find((target) => target.id === id) ?? null;
export const heistChance = (target, crew) => Math.min(MAX_CHANCE, target.chance + Math.max(0, crew - target.minCrew) * CREW_BONUS);

const lobbies = new Map(); // lobbyId -> lobby
let lastId = 0;

/** Why `userData` cannot join, or null. */
export function heistProblem(guildId, userData, settings, target, now = Date.now()) {
  if (jailTimeLeft(userData, now) > 0) return t('in jail');
  const left = (Number(userData.cooldowns?.heist) || 0) + staminaCooldown(userData, cooldownMs(settings.commands.heist.cooldownMinutes)) - now;
  if (left > 0) return t`break for ${Math.ceil(left / 60_000)} more min`;
  if ((userData.wallet || 0) + (userData.bank || 0) < target.gear) return t`needs ${money(guildId, target.gear)} for the gear`;
  return null;
}

const userError = (text) => createError('Heist not possible', ErrorTypes.VALIDATION, text, { expected: true });

function lobbyButtons(lobby, { disabled = false } = {}) {
  const target = getTarget(lobby.targetId);
  const full = lobby.crew.length >= MAX_CREW;
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`napad:dolacz:${lobby.id}`).setLabel(t('Join')).setEmoji('🦹').setStyle(ButtonStyle.Success).setDisabled(disabled || full),
    new ButtonBuilder().setCustomId(`napad:zapros:${lobby.id}`).setLabel(t('Invite')).setEmoji('📨').setStyle(ButtonStyle.Secondary).setDisabled(disabled || full),
    new ButtonBuilder().setCustomId(`napad:start:${lobby.id}`).setLabel(t('Start')).setEmoji('🚨').setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || lobby.crew.length < target.minCrew),
    new ButtonBuilder().setCustomId(`napad:wyjdz:${lobby.id}`).setLabel(t('Leave')).setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  )];
}

function lobbyEmbed(guildId, lobby, settings, { title = null, note = '', color = '#FF9F0A' } = {}) {
  const target = getTarget(lobby.targetId);
  const [min, max] = target.loot.map((value) => Math.floor(value * settings.commands.heist.payoutPercent / 100));
  const crew = lobby.crew.map((member, index) => `${index === 0 ? '👑' : '🦹'} <@${member.id}>`).join('\n');
  const waiting = [...lobby.invited].filter((id) => !lobby.crew.some((member) => member.id === id)).map((id) => `<@${id}>`);
  const missing = Math.max(0, target.minCrew - lobby.crew.length);
  return createEmbed({
    title: title ?? t`${target.emoji} Heist: ${tr(target.name)}`,
    description: [
      note,
      note ? '' : null,
      t`**${lobby.leaderName}** is gathering a crew.${lobby.inviteOnly ? t(' Only invited members can join.') : ''}`,
      missing > 0
        ? t`Needs at least **${target.minCrew}** {0|person|people} - **${missing}** more.`
        : t`Ready! The leader starts with 🚨. Each extra member adds **+${CREW_BONUS}%** chance.`,
      t`-# The lobby closes <t:${Math.floor((lobby.createdAt + LOBBY_TTL_MS) / 1000)}:R>.`,
    ].filter((line) => line !== null).join('\n'),
    color,
    fields: [
      { name: t`Crew ${lobby.crew.length}/${MAX_CREW}`, value: crew || '-', inline: true },
      { name: t('🎯 Chance now'), value: `**${heistChance(target, lobby.crew.length)}%**`, inline: true },
      { name: t('💰 Loot per person'), value: `${money(guildId, min)} - ${money(guildId, max)}`, inline: true },
      { name: t('🧰 Gear'), value: t`${money(guildId, target.gear)} each, paid at the start`, inline: true },
      { name: t('🚔 Caught'), value: t`gear lost, **${Math.round(settings.commands.crime.jailMinutes)} min** in jail for everyone`, inline: true },
      ...(waiting.length ? [{ name: t('📨 Invited'), value: waiting.join(' '), inline: false }] : []),
    ],
    footer: false,
  });
}

export async function lobbyPayload(lobby, extra = {}) {
  const settings = await getEconomySettings(lobby.guildId);
  return { content: '', embeds: [lobbyEmbed(lobby.guildId, lobby, settings, extra)], components: lobbyButtons(lobby), allowedMentions: { parse: [] } };
}

function expire(lobby) {
  if (lobbies.get(lobby.id) !== lobby || lobby.status !== 'open') return;
  lobbies.delete(lobby.id);
  lobby.status = 'closed';
  getEconomySettings(lobby.guildId).then((settings) => lobby.message?.edit({
    embeds: [lobbyEmbed(lobby.guildId, lobby, settings, { title: t('🦹 Heist called off'), note: t('Nobody started it in time.'), color: '#8E8E93' })],
    components: lobbyButtons(lobby, { disabled: true }),
  })).catch(() => {});
}

/** /napad: open a lobby. Returns { lobby, payload }. */
export async function openLobby({ client, guildId, channelId, leader, leaderName, targetId, inviteOnly = false, now = Date.now() }) {
  const target = getTarget(targetId);
  if (!target) throw userError(t('Pick a target from the list.'));
  for (const lobby of lobbies.values()) {
    if (lobby.status === 'open' && lobby.guildId === guildId && lobby.crew.some((member) => member.id === leader.id)) {
      throw userError(t('You are already in a heist crew. Leave it first.'));
    }
  }
  const settings = await getEconomySettings(guildId);
  const userData = await getEconomyData(client, guildId, leader.id, { joint: false });
  const problem = heistProblem(guildId, userData, settings, target, now);
  if (problem) throw userError(t`You cannot start a heist: ${problem}.`);

  lastId = (lastId + 1) % 1_000_000;
  const lobby = {
    id: `${now.toString(36)}${lastId.toString(36)}`, guildId, channelId, targetId, leaderId: leader.id, leaderName,
    crew: [{ id: leader.id, name: leaderName }], invited: new Set(), inviteOnly, createdAt: now, status: 'open', message: null,
  };
  lobbies.set(lobby.id, lobby);
  lobby.timer = setTimeout(() => expire(lobby), LOBBY_TTL_MS);
  lobby.timer.unref?.();
  return { lobby, payload: await lobbyPayload(lobby) };
}

export const getLobby = (lobbyId, now = Date.now()) => {
  const lobby = lobbies.get(lobbyId);
  if (!lobby || lobby.status !== 'open' || now - lobby.createdAt > LOBBY_TTL_MS) return null;
  return lobby;
};

/** Join the lobby. Throws a user error with the reason when it is not possible. */
export async function joinLobby({ client, lobby, user, name, now = Date.now() }) {
  if (lobby.crew.some((member) => member.id === user.id)) throw userError(t('You are already in this crew.'));
  if (lobby.crew.length >= MAX_CREW) throw userError(t`The crew is full (${MAX_CREW} people).`);
  if (lobby.inviteOnly && !lobby.invited.has(user.id)) throw userError(t('This heist is invite-only. Ask the leader for an invite.'));
  for (const other of lobbies.values()) {
    if (other !== lobby && other.status === 'open' && other.guildId === lobby.guildId && other.crew.some((member) => member.id === user.id)) {
      throw userError(t('You are already in another heist crew. Leave it first.'));
    }
  }
  const settings = await getEconomySettings(lobby.guildId);
  const userData = await getEconomyData(client, lobby.guildId, user.id, { joint: false });
  const problem = heistProblem(lobby.guildId, userData, settings, getTarget(lobby.targetId), now);
  if (problem) throw userError(t`You cannot join: ${problem}.`);
  lobby.crew.push({ id: user.id, name });
  return lobbyPayload(lobby);
}

/** Leave; the leader leaving cancels the lobby. Returns the message payload. */
export async function leaveLobby({ lobby, userId }) {
  if (!lobby.crew.some((member) => member.id === userId)) throw userError(t('You are not in this crew.'));
  if (userId === lobby.leaderId) {
    lobbies.delete(lobby.id);
    lobby.status = 'closed';
    clearTimeout(lobby.timer);
    const settings = await getEconomySettings(lobby.guildId);
    return {
      embeds: [lobbyEmbed(lobby.guildId, lobby, settings, { title: t('🦹 Heist called off'), note: t('The leader called it off.'), color: '#8E8E93' })],
      components: lobbyButtons(lobby, { disabled: true }),
    };
  }
  lobby.crew = lobby.crew.filter((member) => member.id !== userId);
  return lobbyPayload(lobby);
}

/** Leader's invites: adds members to the lobby. Returns { added: [ids], skipped: [ids] }. */
export function inviteToLobby(lobby, users) {
  const added = [];
  const skipped = [];
  for (const user of users) {
    if (user.bot || lobby.crew.some((member) => member.id === user.id) || lobby.invited.has(user.id)) skipped.push(user.id);
    else if (lobby.invited.size >= MAX_INVITES * 2) skipped.push(user.id);
    else {
      lobby.invited.add(user.id);
      added.push(user.id);
    }
  }
  return { added, skipped };
}

/** The leader's private member picker. */
export function inviteMenu(lobby) {
  return [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
    .setCustomId(`napad:kogo:${lobby.id}`)
    .setPlaceholder(t('Who do you invite?'))
    .setMinValues(1)
    .setMaxValues(MAX_INVITES))];
}

async function withCrewLocks(guildId, ids, task) {
  const [first, ...rest] = [...ids].sort();
  if (!first) return task();
  return withEconomyLock(guildId, first, () => withCrewLocks(guildId, rest, task));
}

/**
 * Start: check everyone again, take the gear, roll once. Returns { started: false, payload } when the crew is too
 * small after the check, else { started: true, running, result } (show `running`, then `result` after the pause).
 */
export async function startHeist({ client, lobby, now = Date.now(), random = Math.random }) {
  const target = getTarget(lobby.targetId);
  const { guildId } = lobby;
  lobby.status = 'running';
  try {
    return await withCrewLocks(guildId, lobby.crew.map((member) => member.id), async () => {
      const settings = await getEconomySettings(guildId);
      const crew = [];
      const dropped = [];
      for (const member of lobby.crew) {
        const userData = await getEconomyData(client, guildId, member.id, { joint: false });
        const problem = heistProblem(guildId, userData, settings, target, now);
        if (problem) dropped.push(`<@${member.id}>: ${problem}`);
        else crew.push({ ...member, userData });
      }
      if (crew.length < target.minCrew || !crew.some((member) => member.id === lobby.leaderId)) {
        lobby.crew = crew.map(({ id, name }) => ({ id, name }));
        if (!lobby.crew.some((member) => member.id === lobby.leaderId)) lobby.crew.unshift({ id: lobby.leaderId, name: lobby.leaderName });
        lobby.status = 'open';
        return { started: false, payload: await lobbyPayload(lobby, { note: `❌ ${t('Not enough people can go:')}\n${dropped.join('\n')}` }) };
      }

      lobbies.delete(lobby.id);
      clearTimeout(lobby.timer);
      const chance = heistChance(target, crew.length);
      const success = random() * 100 < chance;
      const jailMs = cooldownMs(settings.commands.crime.jailMinutes);
      const lines = [];
      const extras = [];
      for (const member of crew) {
        const { userData } = member;
        spendMoney(userData, target.gear);
        userData.cooldowns = { ...(userData.cooldowns ?? {}), heist: now };
        let progress;
        if (success) {
          const base = target.loot[0] + Math.floor(random() * (target.loot[1] - target.loot[0] + 1));
          const share = scaleEarnings(settings, base * settings.commands.heist.payoutPercent / 100 * earningMultiplier(userData, 'crime'), userData);
          userData.wallet = (userData.wallet || 0) + share;
          progress = recordProgress(userData, { heist: 1, heistWin: 1, earned: share }, { settings, now });
          lines.push(t`💰 <@${member.id}>: **+${money(guildId, share)}**`);
        } else {
          userData.jailedUntil = jailMs > 0 ? now + jailMs : 0;
          progress = recordProgress(userData, { heist: 1, jail: jailMs > 0 ? 1 : 0 }, { settings, now });
          lines.push(t`🚔 <@${member.id}>: jail, gear lost`);
        }
        await setEconomyData(client, guildId, member.id, userData);
        extras.push(...progressEmbeds(progress, guildId));
      }
      logger.info(`[ECONOMY] Heist ${target.id} by ${crew.length} in guild ${guildId}: ${success ? 'success' : 'caught'} (${chance}%)`);

      const running = {
        content: '',
        embeds: [createEmbed({
          title: t`🚨 ${tr(target.name)}: the heist is on...`,
          description: t`${crew.map((member) => `<@${member.id}>`).join(' ')} go in. Chance **${chance}%**.`,
          color: '#FF9F0A',
          footer: false,
        })],
        components: [],
        allowedMentions: { parse: [] },
      };
      const result = {
        content: crew.map((member) => `<@${member.id}>`).join(' '),
        embeds: [createEmbed({
          title: success ? t`✅ ${target.emoji} ${tr(target.name)}: clean getaway!` : t`🚔 ${target.emoji} ${tr(target.name)}: busted!`,
          description: [
            success ? t`The crew got away with the loot. Chance was **${chance}%**.` : t`The police were waiting. Chance was **${chance}%**.`,
            '',
            ...lines,
            dropped.length ? `\n${t('Stayed home:')}\n${dropped.join('\n')}` : null,
            success ? null : t`\n-# Gear (${money(guildId, target.gear)}) is gone. Bail works as after \`/crime\`.`,
          ].filter((line) => line !== null).join('\n'),
          color: success ? '#30D158' : '#FF453A',
          footer: false,
        }), ...extras].slice(0, 10),
        components: [],
        allowedMentions: { users: crew.map((member) => member.id) },
      };
      return { started: true, success, running, result };
    });
  } finally {
    if (lobby.status === 'running') lobby.status = 'done';
  }
}

/** Tests: forget every lobby. */
export function resetHeists() {
  for (const lobby of lobbies.values()) clearTimeout(lobby.timer);
  lobbies.clear();
}
