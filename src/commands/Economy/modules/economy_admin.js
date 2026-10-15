// economy_admin.js — /economy gracz <osoba> (2026-10-15, owner: reset one member's money,
// get someone out of jail, remove upgrades one by one or all). A private admin view with:
//   ekoadmin:reset:<userId>        ask to reset the money        -> ekoadmin:reset-tak:<userId>
//   ekoadmin:wypusc:<userId>       end the jail now
//   ekoadmin:ulepszenia:<userId>   ask to remove every upgrade   -> ekoadmin:ulepszenia-tak:<userId>
//   ekoadmin:pokaz:<userId>        back to the view (cancel)
//   ekoadmin:ulepszenie:<userId>   (menu) remove the picked upgrade completely
// "Money" = the member's own cash and bank, set to the server's starting amounts. Items, cards,
// fish, jobs and upgrades stay. A married member's spouse keeps their part of the shared bank.
// Handlers: interactions/buttons/economy/admin.js and interactions/selectMenus/economy/admin.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed, formatDuration } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { getEconomySettings, money } from '../../../services/economySettings.js';
import { UPGRADES, getUpgrade, getUpgradeLevel, withEconomyLock } from '../../../services/economyUpgrades.js';
import { jailTimeLeft } from '../../../services/economyJail.js';
import { t, tr } from '../../../i18n/index.js';

/** True when the member who pressed may use the admin tools (same right as /economy). */
export const isEconomyAdmin = (interaction) =>
  Boolean((interaction.memberPermissions ?? interaction.member?.permissions)?.has?.(PermissionFlagsBits.ManageGuild));

const ownUpgrades = (userData) => UPGRADES.filter((upgrade) => getUpgradeLevel(userData, upgrade.id) > 0);

/** The admin view of `user`. `confirm` = 'reset' | 'ulepszenia' shows the yes/cancel step. */
export async function buildAdminView({ client, guildId, user, notice = '', confirm = null }) {
  await getEconomySettings(guildId);
  const userData = await getEconomyData(client, guildId, user.id, { joint: false });
  const jail = jailTimeLeft(userData);
  const upgrades = ownUpgrades(userData);

  const embed = createEmbed({
    title: t`🛠️ Economy admin · ${user.username}`,
    description: [
      notice,
      t`💵 Cash: **${money(guildId, userData.wallet || 0)}** · 🏦 Bank: **${money(guildId, userData.bank || 0)}**`,
      jail > 0 ? t`🚔 In jail for **${formatDuration(jail)}** more` : t('🚔 Not in jail'),
      upgrades.length
        ? t`⚡ Upgrades: ${upgrades.map((upgrade) => `${upgrade.emoji} ${tr(upgrade.name)} ${getUpgradeLevel(userData, upgrade.id)}/${upgrade.maxLevel}`).join(', ')}`
        : t('⚡ Upgrades: none'),
    ].filter(Boolean).join('\n'),
    color: '#FF9F0A',
  });

  if (confirm) {
    const yes = confirm === 'reset' ? t('Yes, reset the money') : t('Yes, remove every upgrade');
    return {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ekoadmin:${confirm}-tak:${user.id}`).setLabel(yes).setEmoji('⚠️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ekoadmin:pokaz:${user.id}`).setLabel(t('Cancel')).setStyle(ButtonStyle.Secondary),
      )],
    };
  }

  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ekoadmin:reset:${user.id}`).setLabel(t('Reset money')).setEmoji('💸').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ekoadmin:wypusc:${user.id}`).setLabel(t('Free from jail')).setEmoji('🔓').setStyle(ButtonStyle.Success).setDisabled(jail <= 0),
    new ButtonBuilder().setCustomId(`ekoadmin:ulepszenia:${user.id}`).setLabel(t('Remove every upgrade')).setEmoji('⚡').setStyle(ButtonStyle.Danger).setDisabled(!upgrades.length),
  )];
  if (upgrades.length) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`ekoadmin:ulepszenie:${user.id}`)
      .setPlaceholder(t('Remove one upgrade…'))
      .addOptions(upgrades.map((upgrade) => ({
        label: `${tr(upgrade.name)} ${getUpgradeLevel(userData, upgrade.id)}/${upgrade.maxLevel}`.slice(0, 100),
        value: upgrade.id,
        emoji: upgrade.emoji,
      })))));
  }
  return { embeds: [embed], components };
}

/**
 * Run one admin action on `userId`. Returns the notice for the view.
 * @param {'reset'|'wypusc'|'ulepszenia'|'ulepszenie'} action
 */
export function runAdminAction({ client, guildId, userId, action, upgradeId = null }) {
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId, { joint: false });

    if (action === 'reset') {
      userData.wallet = settings.startingWallet;
      userData.bank = settings.startingBank;
      await setEconomyData(client, guildId, userId, userData);
      return t`✅ Money reset: cash **${money(guildId, settings.startingWallet)}**, bank **${money(guildId, settings.startingBank)}**. Items, cards and upgrades stay.`;
    }
    if (action === 'wypusc') {
      if (jailTimeLeft(userData) <= 0) return t('This member is not in jail.');
      userData.jailedUntil = 0;
      await setEconomyData(client, guildId, userId, userData);
      return t('✅ Freed from jail.');
    }
    if (action === 'ulepszenia') {
      userData.upgrades = {};
      await setEconomyData(client, guildId, userId, userData);
      return t('✅ Every upgrade removed.');
    }
    if (action === 'ulepszenie') {
      const upgrade = getUpgrade(upgradeId);
      if (!upgrade || getUpgradeLevel(userData, upgrade.id) === 0) return t('This member does not have that upgrade.');
      const { [upgrade.id]: removed, ...rest } = userData.upgrades || {};
      userData.upgrades = rest;
      await setEconomyData(client, guildId, userId, userData);
      return t`✅ Removed **${upgrade.emoji} ${tr(upgrade.name)}** (was level ${removed}).`;
    }
    return '';
  });
}
