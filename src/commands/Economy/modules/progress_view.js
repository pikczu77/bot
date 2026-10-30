// progress_view.js — /misje (daily and weekly missions) and /osiagniecia (badges).
// Data and rules: services/progress.js. The swap menu: interactions/selectMenus/economy/missions.js
// (custom id misje:zmien:<ownerId>).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { getEconomySettings, money, scaleEarnings } from '../../../services/economySettings.js';
import { withEconomyLock } from '../../../services/economyUpgrades.js';
import { getPack } from '../../../services/collections.js';
import { getServerLevel } from '../../../services/economyJobs.js';
import { yearClaimState } from '../../../services/seasonalEvents.js';
import {
  BONUS_PACKS, ensureMissions, getAchievement, isUnlocked, missionReward, missionText, missionsEnabled, periodEnd, recordProgress, rerollMission, stat, visibleBadges,
} from '../../../services/progress.js';
import { t, tr } from '../../../i18n/index.js';

const BAR_LENGTH = 10;
export function progressBar(current, goal) {
  const filled = goal > 0 ? Math.min(BAR_LENGTH, Math.round((current / goal) * BAR_LENGTH)) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(BAR_LENGTH - filled);
}

const short = (value) => (value >= 1000 ? `${Math.floor(value / 100) / 10}k`.replace('.0k', 'k') : String(value));

function missionLines(scope, state, guildId, settings) {
  return state.list.map((mission) => {
    const reward = money(guildId, missionReward(settings, mission));
    if (mission.done) return t`✅ ~~${missionText(scope, mission, guildId)}~~ · ${reward}`;
    return t`▫️ ${missionText(scope, mission, guildId)} · **${reward}**\n-# ${progressBar(mission.progress, mission.goal)} ${short(mission.progress)}/${short(mission.goal)}`;
  }).join('\n');
}

function bonusLine(scope, state) {
  const pack = getPack(BONUS_PACKS[scope]);
  return state.bonus
    ? t`🎁 Free ${pack.emoji} ${tr(pack.name)} collected.`
    : t`🎁 All three done: free ${pack.emoji} ${tr(pack.name)}.`;
}

function swapMenu(userData, ownerId, guildId) {
  const options = [];
  for (const scope of ['daily', 'weekly']) {
    const state = userData.missions[scope];
    if (state.rerolled) continue;
    state.list.forEach((mission, index) => {
      if (mission.done) return;
      options.push({
        label: `${scope === 'daily' ? t('Daily') : t('Weekly')}: ${missionText(scope, mission, guildId)}`.replace(/`/g, '').slice(0, 100),
        value: `${scope}.${index}`,
        emoji: '🔄',
      });
    });
  }
  if (!options.length) return [];
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`misje:zmien:${ownerId}`)
    .setPlaceholder(t('Swap one mission (once a day / once a week)'))
    .addOptions(options))];
}

/** The /misje view of `user`. Missions are handed out here when a new day or week began. */
export function buildMissionsView({ guildId, settings, user, userData, viewerId, notice = '' }) {
  const own = viewerId === user.id;
  if (!missionsEnabled(settings)) {
    return { embeds: [createEmbed({ title: t('🎯 Missions'), description: t('Missions are turned off on this server.'), color: '#8E8E93', footer: false })], components: [] };
  }
  const { daily, weekly } = userData.missions;
  const embed = createEmbed({
    title: t`🎯 Missions of ${user.username}`,
    description: notice || t('Missions pay as soon as they are done. Every job, game and pack counts.'),
    color: '#F1C40F',
    footer: false,
  }).addFields(
    { name: t`📅 Today · new ones <t:${Math.floor(periodEnd('daily') / 1000)}:R>`, value: `${missionLines('daily', daily, guildId, settings)}\n${bonusLine('daily', daily)}` },
    { name: t`🗓️ This week · new ones <t:${Math.floor(periodEnd('weekly') / 1000)}:R>`, value: `${missionLines('weekly', weekly, guildId, settings)}\n${bonusLine('weekly', weekly)}` },
  );
  return { embeds: [embed], components: own ? swapMenu(userData, user.id, guildId) : [] };
}

/** Load (and hand out) the missions of `user`, return the view. */
export function showMissions({ client, guildId, user, viewerId }) {
  return withEconomyLock(guildId, user.id, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const before = JSON.stringify(userData.missions ?? null);
    ensureMissions(userData);
    if (JSON.stringify(userData.missions) !== before) await setEconomyData(client, guildId, user.id, userData);
    return buildMissionsView({ guildId, settings, user, userData, viewerId });
  });
}

/** The swap menu: `value` = "daily.1". Returns the new view. */
export function swapMission({ client, guildId, user, value }) {
  return withEconomyLock(guildId, user.id, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const [scope, index] = String(value).split('.');
    const fresh = ['daily', 'weekly'].includes(scope) ? rerollMission(userData, scope, Number(index)) : null;
    if (fresh) await setEconomyData(client, guildId, user.id, userData);
    else ensureMissions(userData);
    const notice = fresh
      ? t`🔄 New mission: **${missionText(scope, fresh, guildId)}**`
      : t('❌ This mission cannot be swapped any more.');
    return buildMissionsView({ guildId, settings, user, userData, viewerId: user.id, notice });
  });
}

// ---------------------------------------------------------------- badges

const BADGES_PER_PAGE = 12;

/** The member's data for the list. Levels reached before the level badges existed are given here. */
export function loadBadges({ client, guildId, user }) {
  return withEconomyLock(guildId, user.id, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const level = await getServerLevel(client, guildId, user.id);
    if (level > stat(userData, 'levelBest')) {
      recordProgress(userData, { level }, { settings });
      await setEconomyData(client, guildId, user.id, userData);
    }
    return { settings, userData, yearClaim: await yearClaimState(guildId) };
  });
}

function badgeButtons({ userId, viewerId, tab, page, pages, claimYear }) {
  const id = (kind, toTab, toPage) => `odznaki:${kind}:${toTab}:${toPage}:${userId}:${viewerId}`;
  const section = (target, label, emoji) => new ButtonBuilder()
    .setCustomId(id('t', target, 0))
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(tab === target ? ButtonStyle.Primary : ButtonStyle.Secondary);
  const buttons = [section('main', t('Badges'), '🏅'), section('event', t('Event badges'), '🎃')];
  if (claimYear) buttons.push(new ButtonBuilder().setCustomId(id('rok', 'event', 0)).setLabel(String(claimYear)).setEmoji('🎉').setStyle(ButtonStyle.Success));
  if (pages > 1) {
    buttons.push(
      new ButtonBuilder().setCustomId(id('p', tab, Math.max(0, page - 1))).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(id('p', tab, Math.min(pages - 1, page + 1))).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
    );
  }
  return [new ActionRowBuilder().addComponents(buttons)];
}

/**
 * The /osiagniecia view: unlocked badges with their dates, then a page of locked ones with progress.
 * `tab`: 'main', or 'event' for the holiday badges (owner, 2026-10-30: their own section).
 */
export function buildAchievementsView({ guildId, settings, user, userData, viewerId = user.id, tab = 'main', page = 0, now = Date.now(), yearClaim = null }) {
  const section = tab === 'event' ? 'event' : 'main';
  // The badge of the year joins the list while the server has it open (services/seasonalEvents.js).
  const yearBadge = section === 'event' && yearClaim?.open && !isUnlocked(userData, yearClaim.badgeId) ? getAchievement(yearClaim.badgeId) : null;
  const badges = [...visibleBadges(userData, section, now), ...(yearBadge ? [yearBadge] : [])];
  const unlocked = [];
  const locked = [];
  for (const achievement of badges) {
    const reward = scaleEarnings(settings, achievement.reward);
    if (isUnlocked(userData, achievement.id)) {
      const at = Math.floor(Number(userData.achievements[achievement.id]) / 1000);
      unlocked.push(`${achievement.emoji} **${tr(achievement.name)}** · <t:${at}:d>`);
    } else {
      const [current, goal] = achievement.progress(userData);
      const counter = goal > 1 ? ` ${short(current)}/${short(goal)}` : '';
      locked.push(`🔒 **${tr(achievement.name)}** - ${tr(achievement.description)} · ${money(guildId, reward)}\n-# ${progressBar(current, goal)}${counter}`);
    }
  }
  const pages = Math.max(1, Math.ceil(locked.length / BADGES_PER_PAGE));
  const current = Math.min(pages - 1, Math.max(0, page));
  const empty = section === 'event'
    ? t('No event badges to get right now. New ones come with the next holiday.')
    : t('No badges yet. Every one pays a reward once.');
  const embed = createEmbed({
    title: section === 'event'
      ? t`🎃 Event badges of ${user.username} · ${unlocked.length}/${badges.length}`
      : t`🏅 Badges of ${user.username} · ${unlocked.length}/${badges.length}`,
    description: current > 0 ? null : (unlocked.length ? unlocked.join('\n') : (locked.length ? t('No badges yet. Every one pays a reward once.') : empty)),
    color: '#F1C40F',
    footer: pages > 1 ? t`Page ${current + 1}/${pages}` : false,
  });
  // Field values are limited to 1024 characters, so the locked list is split.
  let chunk = '';
  let part = 0;
  for (const line of locked.slice(current * BADGES_PER_PAGE, (current + 1) * BADGES_PER_PAGE)) {
    if ((chunk + line).length > 1000) {
      embed.addFields({ name: part === 0 ? t('🔒 Still to get') : '​', value: chunk });
      chunk = '';
      part += 1;
    }
    chunk += `${line}\n`;
  }
  if (chunk) embed.addFields({ name: part === 0 ? t('🔒 Still to get') : '​', value: chunk });
  return { embeds: [embed], components: badgeButtons({ userId: user.id, viewerId, tab: section, page: current, pages, claimYear: yearBadge && viewerId === user.id ? yearClaim.year : null }) };
}
