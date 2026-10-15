// economyJail.js — jail after a failed /crime.
//
// `jailedUntil` in a member's economy data. While it is in the future the member cannot
// earn or play: /work, /nagraj, /fish, /beg, /crime, /slut, /rob and the casino games all
// call assertNotJailed. /daily, the bank, /pay, the shop and the upgrades still work.
// The Stamina upgrade does not shorten jail.
//
// Bail: a member can leave jail at once for `commands.crime.bailPrice` (default 2,000,
// 0 = no bail). The jail messages carry a button `wiezienie:wykup`; whoever presses it
// pays their own bail (interactions/buttons/economy/jail.js). Paid from cash first, then
// from the bank. The price is fixed: no server multiplier, no Discount upgrade.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { formatDuration } from '../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { getEconomySettings, money } from './economySettings.js';
import { spendMoney, withEconomyLock } from './economyUpgrades.js';
import { t } from '../i18n/index.js';

export const BAIL_BUTTON_ID = 'wiezienie:wykup';

/** Milliseconds of jail left, 0 when the member is free. */
export const jailTimeLeft = (userData, now = Date.now()) => Math.max(0, (Number(userData?.jailedUntil) || 0) - now);

/** Bail price of the server, 0 when bail is turned off. */
export const bailPrice = (settings) => Math.max(0, Math.floor(Number(settings?.commands?.crime?.bailPrice) || 0));

/**
 * The bail line and button for a jail message: `{ text: '', components: [] }` when the
 * server turned bail off or `settings` is unknown.
 */
export function bailOffer(settings, guildId) {
  const price = bailPrice(settings);
  if (!price || !guildId) return { text: '', components: [] };
  const button = new ButtonBuilder()
    .setCustomId(BAIL_BUTTON_ID)
    .setLabel(t`Pay bail (${money(guildId, price)})`)
    .setEmoji('🔓')
    .setStyle(ButtonStyle.Success);
  return {
    text: t`\n🔓 You can get out right away: bail costs **${money(guildId, price)}** (cash first, then bank).`,
    components: [new ActionRowBuilder().addComponents(button).toJSON()],
  };
}

/**
 * Throw a user error while the member is in jail. With `settings` and `guildId` the
 * message offers bail (the error context carries the button as `components`).
 */
export function assertNotJailed(userData, now = Date.now(), { settings = null, guildId = null } = {}) {
  const left = jailTimeLeft(userData, now);
  if (left <= 0) return;
  const bail = bailOffer(settings, guildId);
  throw createError(
    "User is in jail",
    ErrorTypes.RATE_LIMIT,
    t`🚔 You're in jail for **${formatDuration(left)}** more. In jail you cannot work, earn money or play in the casino.` + bail.text,
    { jailTimeRemaining: left, cooldownType: 'jail', expected: true, components: bail.components },
  );
}

/**
 * Pay bail for a member.
 * @returns {Promise<{ ok: true, price, userData } | { ok: false, reason: 'free'|'off'|'money', price?, userData }>}
 */
export function payBail(client, guildId, userId, now = Date.now()) {
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    if (jailTimeLeft(userData, now) <= 0) return { ok: false, reason: 'free', userData };
    const price = bailPrice(settings);
    if (!price) return { ok: false, reason: 'off', userData };
    if (!spendMoney(userData, price)) return { ok: false, reason: 'money', price, userData };
    userData.jailedUntil = 0;
    await setEconomyData(client, guildId, userId, userData);
    return { ok: true, price, userData };
  });
}
