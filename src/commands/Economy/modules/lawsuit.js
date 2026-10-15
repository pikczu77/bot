// lawsuit.js — /pozwij: sue another member for any amount (2026-10-15).
//
// The plaintiff picks the amount; before the case starts they see the chance to win and can
// raise or lower the amount with buttons (custom ids pozew:*, interactions/buttons/economy/lawsuit.js).
// Chance = SUE_MAX_CHANCE x (1 - amount / defendant's money)^2, at least 1%: suing for a small
// part of someone's money is likely, for almost all of it nearly hopeless. The amount can never
// be more than the defendant has (cash + bank).
// Won: the defendant pays the amount (cash first, then bank); the plaintiff gets it plus the
// "Street smarts" upgrade bonus (the same one as /crime and /slut). No Fortune, no server multiplier.
// Lost: the plaintiff pays court costs (`courtCostPercent` of the amount) to the defendant;
// Insurance pays them once instead. Blocked in jail; Stamina shortens the break.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed, formatDuration } from '../../../utils/embeds.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { cooldownMs, getEconomySettings, money } from '../../../services/economySettings.js';
import { earningMultiplier, spendMoney, staminaCooldown, upgradeBonusLine, withEconomyLock } from '../../../services/economyUpgrades.js';
import { assertNotJailed } from '../../../services/economyJail.js';
import { t } from '../../../i18n/index.js';

export const SUE_MAX_CHANCE = 0.6;
export const SUE_MIN_CHANCE = 0.01;
/** Buttons that change the amount: [custom id step, label, factor]. */
const STEPS = [['d50', '-50%', 0.5], ['d10', '-10%', 0.9], ['u10', '+10%', 1.1], ['u50', '+50%', 1.5]];

const wealth = (userData) => Math.max(0, Math.floor(userData.wallet || 0)) + Math.max(0, Math.floor(userData.bank || 0));

/** Chance (0-1) to win a case for `amount` against someone with `defendantMoney`. */
export function sueChance(amount, defendantMoney) {
  if (!(defendantMoney > 0) || !(amount > 0) || amount > defendantMoney) return 0;
  const ratio = amount / defendantMoney;
  return Math.max(SUE_MIN_CHANCE, SUE_MAX_CHANCE * (1 - ratio) ** 2);
}

const percent = (chance) => `${Number((chance * 100).toFixed(chance < 0.1 ? 1 : 0))}%`;

/** Lock both members' economy in a fixed order, so two crossed lawsuits cannot block each other. */
function withBothLocks(guildId, firstId, secondId, task) {
  const [a, b] = [firstId, secondId].sort();
  return withEconomyLock(guildId, a, () => withEconomyLock(guildId, b, task));
}

async function checkCase({ client, guildId, plaintiff, defendant, now = Date.now() }) {
  if (defendant.id === plaintiff.id) {
    throw createError('Cannot sue yourself', ErrorTypes.VALIDATION, t('You cannot sue yourself.'), { expected: true });
  }
  if (defendant.bot) {
    throw createError('Cannot sue a bot', ErrorTypes.VALIDATION, t('Bots cannot be sued.'), { expected: true });
  }
  const settings = await getEconomySettings(guildId);
  const { sue } = settings.commands;
  const plaintiffData = await getEconomyData(client, guildId, plaintiff.id);
  const defendantData = await getEconomyData(client, guildId, defendant.id);
  assertNotJailed(plaintiffData, now, { settings, guildId });
  if (plaintiffData._joint?.partnerId === defendant.id) {
    throw createError('Cannot sue the spouse', ErrorTypes.VALIDATION, t('You cannot sue your spouse - you share the bank.'), { expected: true });
  }

  const cooldown = staminaCooldown(plaintiffData, cooldownMs(sue.cooldownMinutes));
  const last = plaintiffData.cooldowns?.sue || 0;
  if (now < last + cooldown) {
    throw createError('Lawsuit cooldown active', ErrorTypes.RATE_LIMIT,
      t`The court is still busy with your last case. Sue again in **${formatDuration(last + cooldown - now)}**.`,
      { remaining: last + cooldown - now, cooldownType: 'sue' });
  }
  const defendantMoney = wealth(defendantData);
  if (defendantMoney < sue.minDefendantMoney) {
    throw createError('Defendant too poor', ErrorTypes.VALIDATION,
      t`${defendant.username} has less than ${money(guildId, sue.minDefendantMoney)} (cash and bank) - not worth a lawsuit.`,
      { expected: true });
  }
  return { settings, sue, plaintiffData, defendantData, defendantMoney };
}

/** The case before it starts: chance, what is at stake, buttons to change the amount. */
export async function buildSuePreview({ client, guildId, plaintiff, defendant, amount, notice = '' }) {
  const { sue, plaintiffData, defendantMoney } = await checkCase({ client, guildId, plaintiff, defendant });
  const claim = Math.max(1, Math.min(Math.floor(amount) || 1, defendantMoney));
  const chance = sueChance(claim, defendantMoney);
  const costs = Math.floor(claim * sue.courtCostPercent / 100);
  const bonus = upgradeBonusLine(plaintiffData, 'crime', guildId);

  const embed = createEmbed({
    title: t('⚖️ Lawsuit'),
    description: (notice ? `${notice}\n\n` : '') +
      t`You sue **${defendant.username}** for **${money(guildId, claim)}**.\nChance to win: **${percent(chance)}**\n\n✅ Won: you get **${money(guildId, Math.floor(claim * earningMultiplier(plaintiffData, 'crime')))}**\n❌ Lost: you pay **${money(guildId, costs)}** court costs to ${defendant.username}` +
      bonus + t('\n\n-# A higher amount = a smaller chance. Change it with the buttons, then start the case.'),
    color: '#F1C40F',
  });

  const base = `${plaintiff.id}:${defendant.id}:${claim}`;
  const steps = new ActionRowBuilder().addComponents(STEPS.map(([step, label, factor]) => {
    const next = Math.max(1, Math.min(Math.floor(claim * factor), defendantMoney));
    return new ButtonBuilder()
      .setCustomId(`pozew:zmien:${base}:${step}`)
      .setLabel(`${label} (${money(guildId, next)})`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(next === claim);
  }));
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pozew:start:${base}`).setLabel(t`Sue (${percent(chance)})`).setEmoji('⚖️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`pozew:anuluj:${plaintiff.id}`).setLabel(t('Cancel')).setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [steps, actions] };
}

/** The amount after pressing a step button. */
export function stepAmount(amount, step) {
  const factor = STEPS.find(([id]) => id === step)?.[2] ?? 1;
  return Math.max(1, Math.floor(amount * factor));
}

/**
 * Run the case. Returns the public result message.
 * When the defendant has less money than `amount` by now, returns `{ preview }` instead.
 */
export async function runLawsuit({ client, guildId, plaintiff, defendant, amount, random = Math.random }) {
  return withBothLocks(guildId, plaintiff.id, defendant.id, async () => {
    const now = Date.now();
    const { sue, plaintiffData, defendantData, defendantMoney } = await checkCase({ client, guildId, plaintiff, defendant, now });
    if (amount > defendantMoney) return { preview: true };

    const chance = sueChance(amount, defendantMoney);
    plaintiffData.cooldowns = { ...(plaintiffData.cooldowns || {}), sue: now };
    let embed;

    if (random() < chance) {
      spendMoney(defendantData, amount);
      const won = Math.floor(amount * earningMultiplier(plaintiffData, 'crime'));
      plaintiffData.wallet = (plaintiffData.wallet || 0) + won;
      embed = createEmbed({
        title: t('⚖️ Case won!'),
        description: t`The court agreed with **${plaintiff.username}**: **${defendant.username}** pays **${money(guildId, amount)}**.\n${plaintiff.username} gets **${money(guildId, won)}** (chance was ${percent(chance)}).` +
          upgradeBonusLine(plaintiffData, 'crime', guildId),
        color: '#30D158',
      });
    } else {
      const costs = Math.floor(amount * sue.courtCostPercent / 100);
      const insured = costs > 0 && (plaintiffData.inventory?.insurance || 0) > 0;
      let paid = costs;
      if (insured) {
        plaintiffData.inventory = { ...plaintiffData.inventory, insurance: plaintiffData.inventory.insurance - 1 };
      } else {
        paid = Math.min(costs, wealth(plaintiffData));
        spendMoney(plaintiffData, paid);
      }
      defendantData.wallet = (defendantData.wallet || 0) + paid;
      embed = createEmbed({
        title: t('⚖️ Case lost!'),
        description: t`The court threw out the case of **${plaintiff.username}** against **${defendant.username}** (chance was ${percent(chance)}).\n` +
          (insured
            ? t`📋 **Insurance** paid the court costs: **${money(guildId, paid)}** go to ${defendant.username}.`
            : t`${plaintiff.username} pays **${money(guildId, paid)}** court costs to ${defendant.username}.`),
        color: '#FF453A',
      });
    }

    await setEconomyData(client, guildId, defendant.id, defendantData);
    await setEconomyData(client, guildId, plaintiff.id, plaintiffData);
    return { result: { content: `<@${defendant.id}>`, embeds: [embed], allowedMentions: { users: [defendant.id] } } };
  });
}
