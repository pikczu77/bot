// /economy poradnik — the economy guide for an info channel (#ekonomia-info). It lists every
// economy command and explains earning, the bank and robberies, the casino and luck, the
// upgrades, the shop, jail, Stamina, Fortune and marriage, with this server's numbers
// (payouts, breaks, chances, prices). Posting it again in the same channel edits the earlier
// messages instead of adding new ones, so it can be refreshed after a balance change.

import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed, formatDuration, successEmbed } from '../../../utils/embeds.js';
import { guildStore } from '../../../utils/featureKit.js';
import { createError, ErrorTypes, withErrorHandling } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { cooldownMs, getEconomySettings, getShopItems, money } from '../../../services/economySettings.js';
import { BANK_STEAL_BASE_PERCENT, UPGRADES, describeUpgradeEffect, upgradePrice } from '../../../services/economyUpgrades.js';
import { JOBS, JOB_SHIFTS } from '../../../services/economyJobs.js';
import { MAX_LUCK, SLOT_BASE_CHANCE, formatChance } from '../../../services/casino.js';
import { getLevelingConfig } from '../../../services/leveling/leveling.js';
import { getItemById } from '../../../config/shop/items.js';
import { itemLabel } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

const store = guildStore('economy-guide', { channelId: null, messageIds: [] });

// Discord allows 10 embeds and 6,000 characters of embed text per message.
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_CHARS_PER_MESSAGE = 5_500;
const MAX_DESCRIPTION = 4_000;

const GUIDE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const join = (...lines) => lines.filter((line) => line !== null && line !== undefined && line !== false).join('\n');
const clip = (text) => (text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text);

function overview({ guildId, settings }) {
  const tax = Number(settings.payTaxPercent) || 0;
  const multiplier = Number(settings.earningsPercent) || 100;
  return {
    title: t('📊 Economy - how it works'),
    description: join(
      t('Money lives in two places: 💵 **cash** and 🏦 **bank**. Cash can be stolen with `/rob`, the bank is safer but has a limit.'),
      settings.startingWallet > 0 ? t`Every new member starts with **${money(guildId, settings.startingWallet)}** cash.` : null,
      multiplier !== 100 ? t`🌟 Server multiplier: every payout x${multiplier / 100}.` : null,
      '',
      t('**Basic commands**'),
      t("`/hajs` or `/balans` - your balance (or someone else's)"),
      t('`/bank wplac` / `/bank wyplac` - move money between cash and the bank'),
      tax > 0 ? t`\`/pay\` - send money to someone (${tax}% fee)` : t('`/pay` - send money to someone'),
      t('`/topkasa` - the richest members'),
      t('`/ekwipunek` - your items'),
      t('`/sklep` - the shop · `/ulepszenia` - permanent upgrades'),
    ),
  };
}

function earning({ guildId, settings, leveling }) {
  const { work, daily, mine, fish, beg, crime, slut } = settings.commands;
  const best = JOBS[JOBS.length - 1];
  const range = ({ min, max }) => `${money(guildId, min)} - ${money(guildId, max)}`;
  const wait = (minutes) => formatDuration(cooldownMs(minutes));
  const perLevel = Math.max(0, Math.floor(Number(leveling?.moneyPerLevel) || 0));
  return {
    title: t('💼 How to earn'),
    description: join(
      t`\`/work\` - a job. The first \`/work\` shows 3 offers for your server level: the higher the level, the better the pay (${best.emoji} ${tr(best.name)} from level ${best.level}). A contract lasts ${JOB_SHIFTS} shifts. Break: ${wait(work.cooldownMinutes)}.`,
      t`\`/daily\` - ${money(guildId, daily.amount)} once every ${wait(daily.cooldownMinutes)}.`,
      t`\`/mine\` - ${range(mine)}, break ${wait(mine.cooldownMinutes)}. You need a pickaxe from \`/sklep\`.`,
      t`\`/fish\` - ${range(fish)}, break ${wait(fish.cooldownMinutes)}. You need a fishing rod from \`/sklep\`.`,
      t`\`/beg\` - ${range(beg)}, ${beg.successPercent}% chance, break ${wait(beg.cooldownMinutes)}.`,
      t`\`/crime\` - 5 kinds of crime: the bigger the haul, the bigger the risk. Break ${wait(crime.cooldownMinutes)}. Caught: a fine and ${wait(crime.jailMinutes)} in jail.`,
      t`\`/slut\` - a random payout or a loss. Break ${wait(slut.cooldownMinutes)}.`,
      settings.activity.enabled
        ? t`💬 Chatting: ${money(guildId, settings.activity.amount)} per message, at most once every ${formatDuration(settings.activity.cooldownSeconds * 1000)}.`
        : null,
      perLevel > 0 ? t`⭐ Level up: ${money(guildId, perLevel)} for every new level.` : null,
      '',
      t('-# Amounts before bonuses. Every payout shows the bonuses that worked: items, upgrades, Fortune and the server multiplier.'),
    ),
  };
}

function bankAndRobbery({ guildId, settings }) {
  const { rob } = settings.commands;
  const label = (id) => itemLabel(getItemById(id));
  return {
    title: t('🏦 Bank and robberies'),
    description: join(
      t`\`/rob @someone\` - ${rob.successPercent}% chance of success. You take **${rob.stealPercent}%** of their cash and **${BANK_STEAL_BASE_PERCENT}%** of their bank. Break ${formatDuration(cooldownMs(rob.cooldownMinutes))}.`,
      t`The victim needs at least ${money(guildId, rob.minVictimCash)} (cash and bank). A failed robbery costs you ${rob.finePercent}% of your cash.`,
      '',
      t`**Protection:** ${label('personal_safe')} stops one robbery · 🛡️ Bank security: robbers take 10 points less of your bank per level (down to 10%) · ${label('insurance')} pays one fine.`,
      t`**For robbers:** ${label('lockpick')} +20% for one robbery · 🥷 Thief upgrade +5% per level.`,
      t('🏦 Bigger vault gives the bank more room. 📈 Interest pays a part of your bank with every `/daily`.'),
    ),
  };
}

function casino({ guildId, settings }) {
  const { gamble } = settings.commands;
  const points = (id) => getItemById(id)?.bonusPercent ?? getItemById(id)?.luckPercent ?? 0;
  return {
    title: t('🎰 Casino'),
    description: join(
      t`\`/gamble\` - ${gamble.winPercent}% chance, a win pays x${gamble.payoutPercent / 100}.`,
      t('`/ruletka` - colour, even/odd, 1-18/19-36 pay x2 · a dozen pays x3 · zero or one number pays x36.'),
      t`\`/slots\` - ${formatChance(SLOT_BASE_CHANCE)}% chance of a winning line, up to x25 for 💎💎💎.`,
      t('`/blackjack` - beat the dealer (stands on 17), blackjack pays 3:2, you can double down.'),
      t`One break for all games: ${formatDuration(cooldownMs(gamble.cooldownMinutes))}. Highest bet: ${gamble.maxBet > 0 ? money(guildId, gamble.maxBet) : t('no limit')}.`,
      '',
      t('**🍀 Luck**'),
      t('Luck adds percentage points to your win chance: 40% with luck +3 becomes 43%.'),
      t`Sources: 🍀 Luck upgrade +1 per level (15 levels) · clover +${points('golden_clover')} (golden) or +${points('diamond_clover')} (diamond) · one per game: Lucky Clover +${points('lucky_clover')}, Lucky Charm +${points('lucky_charm')} (3 games). Together at most +${MAX_LUCK}.`,
      t('Bets that pay more than x2 get fewer points: x3 gets less than half, a roulette number almost none. In blackjack luck is the chance that a card which would bust you is swapped.'),
      t('Under every game you see your exact win chance.'),
    ),
  };
}

function upgrades({ guildId }) {
  return {
    title: t('⚡ Upgrades (/ulepszenia)'),
    description: join(
      t('Bought once, they stay forever. You pay with cash first, then from the bank. 🏷️ Discount makes the shop and the other upgrades cheaper.'),
      '',
      ...UPGRADES.map((upgrade) =>
        t`${upgrade.emoji} **${tr(upgrade.name)}** (${upgrade.maxLevel} {2|level|levels}): ${describeUpgradeEffect(upgrade, upgrade.maxLevel, guildId)} at max · from ${money(guildId, upgradePrice(upgrade, 0))}`),
      '',
      t('🎒 The **Items** folder: a better rod, pickaxe and computer (+50%, then +100% earnings) and clovers (luck).'),
    ),
  };
}

function shop({ guildId, settings, guild }) {
  const items = getShopItems(settings, guild);
  const consumables = items.filter((item) => item.type === 'consumable');
  const roles = items.filter((item) => item.type === 'role' && item.custom);
  return {
    title: t('🛒 Shop (/sklep)'),
    description: join(
      t('Buy with `/sklep kup:` or with the buttons in `/sklep`. Your items: `/ekwipunek`.'),
      consumables.length ? `\n${t('**One-use items**')}` : null,
      ...consumables.map((item) => `${itemLabel(item)} · **${money(guildId, item.price)}** - ${tr(item.description)}`),
      roles.length ? `\n${t('**Roles for sale**')}` : null,
      ...roles.map((item) => `${item.name} · **${money(guildId, item.price)}**`),
    ),
  };
}

function rules({ settings }) {
  return {
    title: t('📜 Jail, Stamina, Fortune, marriage'),
    description: join(
      t('**🚔 Jail**'),
      t`A failed \`/crime\` puts you in jail for ${formatDuration(cooldownMs(settings.commands.crime.jailMinutes))}. In jail you cannot work, earn money or play: \`/work\`, \`/mine\`, \`/fish\`, \`/beg\`, \`/crime\`, \`/slut\`, \`/rob\` and the casino are locked. \`/daily\`, the bank, \`/pay\`, the shop and upgrades still work.`,
      '',
      t('**⚡ Stamina**'),
      t('Every level shortens the breaks by 5% (at most -50% at level 10): `/work`, `/mine`, `/fish`, `/beg`, `/crime`, `/slut`, `/rob` and the casino. It does not shorten `/daily` or jail.'),
      '',
      t('**💰 Fortune**'),
      t('Every level adds +10% to all earnings (at most +50%), counted last, after all other bonuses. It does not change casino wins or robberies.'),
      '',
      t('**💍 Dates and marriage**'),
      t('`/randka @someone` - a date, the inviter pays. `/slub oswiadcz` - a marriage: one shared bank, separate accounts. `/slub rozwod` splits the bank in half.'),
    ),
  };
}

/** The guide as embeds, in reading order. */
export async function buildGuideEmbeds(client, guild) {
  const settings = await getEconomySettings(guild.id);
  const leveling = await getLevelingConfig(client, guild.id).catch(() => null);
  const context = { guildId: guild.id, guild, settings, leveling };
  const sections = [overview, earning, bankAndRobbery, casino, upgrades, shop, rules].map((build) => build(context));
  return sections.map((section, index) => createEmbed({
    title: section.title,
    description: clip(section.description),
    timestamp: index === sections.length - 1,
    footer: index === sections.length - 1 ? { text: t('Economy guide · /economy poradnik refreshes it') } : false,
  }));
}

const embedLength = (embed) => (embed.data.title?.length ?? 0) + (embed.data.description?.length ?? 0) + (embed.data.footer?.text?.length ?? 0);

/** Split the embeds into messages that Discord accepts. */
export function packEmbeds(embeds) {
  const messages = [];
  let current = [];
  let length = 0;
  for (const embed of embeds) {
    const size = embedLength(embed);
    if (current.length && (current.length >= MAX_EMBEDS_PER_MESSAGE || length + size > MAX_CHARS_PER_MESSAGE)) {
      messages.push(current);
      current = [];
      length = 0;
    }
    current.push(embed);
    length += size;
  }
  if (current.length) messages.push(current);
  return messages;
}

/**
 * Post the guide in `channel`, or edit the copy posted there before.
 * @returns {Promise<{ edited: boolean, count: number }>}
 */
export async function postEconomyGuide({ client, guild, channel }) {
  const batches = packEmbeds(await buildGuideEmbeds(client, guild));
  const stored = await store.get(guild.id);

  const previous = [];
  if (stored.channelId === channel.id) {
    for (const id of stored.messageIds ?? []) {
      const message = await channel.messages.fetch(id).catch(() => null);
      if (message) previous.push(message);
    }
  }

  let messages = previous;
  const edited = previous.length > 0 && previous.length === batches.length;
  if (edited) {
    for (const [index, message] of previous.entries()) await message.edit({ embeds: batches[index] });
  } else {
    for (const message of previous) await message.delete().catch(() => null);
    messages = [];
    for (const embeds of batches) messages.push(await channel.send({ embeds, allowedMentions: { parse: [] } }));
  }

  await store.set(guild.id, { channelId: channel.id, messageIds: messages.map((message) => message.id) });
  logger.info(`[ECONOMY] Economy guide ${edited ? 'edited' : 'posted'} in ${channel.id} (${messages.length} messages)`, { guildId: guild.id });
  return { edited, count: messages.length };
}

export default {
  execute: withErrorHandling(async (interaction, config, client) => {
    const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferred) return;

    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    if (!channel || !GUIDE_CHANNEL_TYPES.includes(channel.type)) {
      throw createError('Guide channel is not a text channel', ErrorTypes.VALIDATION, t('Pick a text channel for the guide.'), { expected: true });
    }
    const me = interaction.guild.members.me;
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
    if (me && !channel.permissionsFor(me)?.has(needed)) {
      throw createError('Missing permissions in the guide channel', ErrorTypes.PERMISSION,
        t`I can't post in ${channel.toString()}. I need: View Channel, Send Messages, Embed Links and Read Message History.`, { expected: true });
    }

    const result = await postEconomyGuide({ client, guild: interaction.guild, channel });
    await InteractionHelper.safeEditReply(interaction, {
      embeds: [successEmbed(
        t('📊 Economy guide'),
        result.edited
          ? t`The guide in ${channel.toString()} is up to date (${result.count} {1|message|messages} edited).`
          : t`The guide is posted in ${channel.toString()} (${result.count} {1|message|messages}). Run the command again to refresh it after changes.`,
      )],
    });
  }, { command: 'economy poradnik' }),
};
