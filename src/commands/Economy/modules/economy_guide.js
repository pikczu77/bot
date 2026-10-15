// /economy poradnik — the economy guide for an info channel (#ekonomia-info).
//
// The channel gets ONE short message with a topic menu. Picking a topic opens that tutorial
// as a private reply (only the member who picked sees it), with the same menu to switch
// topics. The tutorials are built from this server's settings at the moment they are opened,
// so they never go out of date; the channel message only needs a repost when its own text
// changes. Posting again in the same channel edits (or replaces) the earlier message.
// The menu is handled by src/interactions/selectMenus/economy/guide.js.

import { ActionRowBuilder, ChannelType, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { guildStore } from '../../../utils/featureKit.js';
import { createError, ErrorTypes, withErrorHandling } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { cooldownMs, getEconomySettings, getShopItems, money } from '../../../services/economySettings.js';
import {
  BANK_STEAL_BASE_PERCENT, BANK_STEAL_MIN_PERCENT, BANK_STEAL_STEP_PERCENT, LUCK_PER_LEVEL, STAMINA_PER_LEVEL,
  UPGRADES, describeUpgradeEffect, getUpgrade, upgradePrice,
} from '../../../services/economyUpgrades.js';
import { JOBS, JOB_SHIFTS } from '../../../services/economyJobs.js';
import { VIDEO_RARITIES } from '../mine.js';
import { FISH, PACKS, packExpectedValue, packLegendaryChance } from '../../../services/collections.js';
import { bailPrice } from '../../../services/economyJail.js';
import { MAX_LUCK, SLOT_BASE_CHANCE, SLOT_OUTCOMES, formatChance } from '../../../services/casino.js';
import { DATE_COOLDOWN_MS } from '../../../services/marriageService.js';
import { getLevelingConfig } from '../../../services/leveling/leveling.js';
import { ITEM_CHAINS, getItemById } from '../../../config/shop/items.js';
import { itemLabel } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

const store = guildStore('economy-guide', { channelId: null, messageIds: [] });

export const GUIDE_MENU_ID = 'poradnik';
const GUIDE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** "45 min", "1 h", "1 h 30 min", "24 h" — easier to read than "1d". */
function wait(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds <= 0) return t('no break');
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}
const waitMinutes = (minutes) => wait(cooldownMs(minutes));
// Joins lines, skipping null/false; '' stays as an empty line for spacing.
const lines = (...items) => items.filter((item) => item !== null && item !== undefined && item !== false).join('\n');
const field = (name, value, inline = true) => ({ name, value, inline });

// ---- Topics: each returns { description, fields } built from the server's settings ----

function start({ guildId, settings }) {
  const multiplier = Number(settings.earningsPercent) || 100;
  return {
    description: lines(
      t('Money lives in two places: 💵 **cash** and 🏦 **bank**. Anyone can steal your cash with `/rob`; the bank is safer but has a limit.'),
      settings.startingWallet > 0 ? t`New members start with **${money(guildId, settings.startingWallet)}** cash.` : null,
      multiplier !== 100 ? t`🌟 Server multiplier: every payout **x${multiplier / 100}**.` : null,
    ),
    fields: [
      field(t('1️⃣ Earn'), t('`/daily` every day\n`/work` as often as you can')),
      field(t('2️⃣ Keep it safe'), t('Move cash to the bank:\n`/bank wplac`')),
      field(t('3️⃣ Grow'), t('Tools in `/sklep`\nupgrades in `/ulepszenia`')),
      field(t('💵 Balance'), t('`/hajs` or `/balans`')),
      field(t('🏆 Ranking'), '`/topkasa`'),
      field(t('🎒 Your items'), '`/ekwipunek`'),
    ],
  };
}

function earn({ guildId, settings, leveling }) {
  const { work, daily, mine, fish, beg, crime, slut, sue } = settings.commands;
  const range = ({ min, max }) => `**${money(guildId, min)} - ${money(guildId, max)}**`;
  const lowest = Math.min(...JOBS.map((job) => job.min));
  const best = JOBS[JOBS.length - 1];
  const perLevel = Math.max(0, Math.floor(Number(leveling?.moneyPerLevel) || 0));
  return {
    description: t('-# Amounts before bonuses: items, upgrades, Fortune and the server multiplier make them bigger.'),
    fields: [
      field(t('💼 /work'), t`**${money(guildId, lowest)} - ${money(guildId, best.max)}** a shift\njobs for your server level\n${JOB_SHIFTS} shifts per contract\nbreak **${waitMinutes(work.cooldownMinutes)}**`),
      field(t('📅 /daily'), t`**${money(guildId, daily.amount)}**\nonce every **${waitMinutes(daily.cooldownMinutes)}**`),
      field(t('🎬 /nagraj'), t`YouTube: views decide the pay\ncommon **x${VIDEO_RARITIES[0].multiplier}** · legendary **x${VIDEO_RARITIES.at(-1).multiplier}** of ${range(mine)}\nbreak **${waitMinutes(mine.cooldownMinutes)}**\nneeds a computer`),
      field(t('🎣 /fish'), t`${range(fish)}\nbreak **${waitMinutes(fish.cooldownMinutes)}**\nneeds a fishing rod`),
      field(t('🙏 /beg'), t`${range(beg)}\n**${beg.successPercent}%** chance\nbreak **${waitMinutes(beg.cooldownMinutes)}**`),
      field(t('🦹 /crime'), t`bigger haul, bigger risk\nbreak **${waitMinutes(crime.cooldownMinutes)}**\ncaught: fine + **${waitMinutes(crime.jailMinutes)}** in jail`),
      field(t('💋 /slut'), t`payout or loss\nbreak **${waitMinutes(slut.cooldownMinutes)}**`),
      field(t('⚖️ /pozwij @someone'), t`any amount: higher = lower chance\nlost: **${sue.courtCostPercent}%** court costs\nbreak **${waitMinutes(sue.cooldownMinutes)}**`),
      settings.activity.enabled
        ? field(t('💬 Chatting'), t`**${money(guildId, settings.activity.amount)}** a message\nat most every **${wait(settings.activity.cooldownSeconds * 1000)}**`)
        : null,
      perLevel > 0 ? field(t('⭐ Level up'), t`**${money(guildId, perLevel)}** for every new level`) : null,
      field(t('📈 Better jobs'), t`The higher your level on the server, the better the offers. ${best.emoji} ${tr(best.name)} from level **${best.level}**.`, false),
    ].filter(Boolean),
  };
}

function bank({ guildId, settings }) {
  const { rob } = settings.commands;
  const label = (id) => itemLabel(getItemById(id));
  const tax = Number(settings.payTaxPercent) || 0;
  return {
    description: t('Keep your money in the bank. Cash is what robbers take first.'),
    fields: [
      field(t('🏦 Bank'), t('`/bank wplac` · `/bank wyplac`\nhas a limit: 🏦 Bigger vault\n📈 Interest pays with `/daily`')),
      field(t('🦹 /rob @someone'), t`**${rob.successPercent}%** chance\ntakes **${rob.stealPercent}%** cash + **${BANK_STEAL_BASE_PERCENT}%** bank\nbreak **${waitMinutes(rob.cooldownMinutes)}**`),
      field(t('❌ Failed robbery'), t`fine: **${rob.finePercent}%** of your cash\nvictim needs at least **${money(guildId, rob.minVictimCash)}**`),
      field(t('🛡️ Protection'), t`${label('personal_safe')}: stops 1 robbery\n🛡️ Bank security: -${BANK_STEAL_STEP_PERCENT} pts a level (min ${BANK_STEAL_MIN_PERCENT}%)\n${label('insurance')}: pays 1 fine`),
      field(t('🗝️ For robbers'), t`${label('lockpick')}: +20% once\n🥷 Thief: +5% a level`),
      field(t('💸 /pay @someone'), tax > 0 ? t`send money\nfee **${tax}%**` : t('send money\nno fee')),
    ],
  };
}

function casino({ guildId, settings }) {
  const { gamble } = settings.commands;
  const top = SLOT_OUTCOMES[0];
  return {
    description: t`One break for all games: **${waitMinutes(gamble.cooldownMinutes)}** · highest bet: **${gamble.maxBet > 0 ? money(guildId, gamble.maxBet) : t('no limit')}**`,
    fields: [
      field(t('🎲 /gamble'), t`**${gamble.winPercent}%** chance\na win pays **x${gamble.payoutPercent / 100}**`),
      field(t('🎡 /ruletka'), t('**x2:** colour, even/odd, half\n**x3:** a dozen\n**x36:** zero or one number')),
      field(t('🎰 /slots'), t`**${formatChance(SLOT_BASE_CHANCE)}%** chance\nup to **x${top.payout}** (${top.symbols[0].repeat(3)})`),
      field(t('🃏 /blackjack'), t('dealer stands on 17\nblackjack pays **3:2**\nyou can double down')),
      field(t('🎯 Your chance'), t('Every game shows your exact win chance under the result.')),
      field(t('🍀 Luck'), t('Raises the chance. Pick the 🍀 Luck topic for details.')),
    ],
  };
}

function luck({ settings }) {
  const points = (id) => getItemById(id)?.bonusPercent ?? getItemById(id)?.luckPercent ?? 0;
  const base = settings.commands.gamble.winPercent;
  const levels = getUpgrade('luck')?.maxLevel ?? 0;
  return {
    description: t`Luck adds percentage points to your win chance.\nExample: \`/gamble\` **${base}%** with luck **+5** = **${Math.min(95, base + 5)}%**.`,
    fields: [
      field(t('🍀 Luck upgrade'), t`**+${LUCK_PER_LEVEL}%** a level\n${levels} levels`),
      field(t('🍀 Clovers (for good)'), t`golden **+${points('golden_clover')}%**\ndiamond **+${points('diamond_clover')}%**`),
      field(t('🍀 For one game'), t`${itemLabel(getItemById('lucky_clover'))} **+${points('lucky_clover')}%**\n${itemLabel(getItemById('lucky_charm'))} **+${points('lucky_charm')}%** (3 games)`),
      field(t('🔝 Limit'), t`all luck together: at most **+${MAX_LUCK}%**`),
      field(t('🎡 Big payouts'), t('x3 bets: less than half of your luck\nroulette number (x36): almost none')),
      field(t('🃏 Blackjack'), t('luck = chance that a card which would bust you is swapped')),
    ],
  };
}

function upgrades({ guildId }) {
  return {
    description: t('Bought once, kept forever. You pay with cash first, then from the bank. 🏷️ Discount lowers the shop prices and the other upgrades.'),
    fields: UPGRADES.map((upgrade) => field(
      t`${upgrade.emoji} ${tr(upgrade.name)} · ${upgrade.maxLevel} {2|level|levels}`,
      t`max: **${describeUpgradeEffect(upgrade, upgrade.maxLevel, guildId)}**\nfrom **${money(guildId, upgradePrice(upgrade, 0))}**`,
    )),
  };
}

function shop({ guildId, settings, guild }) {
  const items = getShopItems(settings, guild);
  const prices = new Map(items.map((item) => [item.id, item.price]));
  const tiers = ITEM_CHAINS.map((chain) => field(
    `${chain.emoji} ${tr(chain.name)}`,
    chain.items.filter((item) => prices.has(item.id))
      .map((item) => `${itemLabel(item)}\n**${money(guildId, prices.get(item.id))}**${item.bonusPercent ? ` · +${item.bonusPercent}%` : ''}`)
      .join('\n') || t('not for sale'),
  ));
  const consumables = items.filter((item) => item.type === 'consumable')
    .map((item) => field(itemLabel(item), `**${money(guildId, item.price)}**\n-# ${tr(item.description)}`));
  const roles = items.filter((item) => item.type === 'role' && item.custom);
  return {
    description: t('Buy with `/sklep kup:` or the buttons in `/sklep`. Tools stay forever, one-use items are used up by their command. Your items: `/ekwipunek`.'),
    fields: [
      ...tiers,
      ...consumables,
      roles.length ? field(t('🎭 Roles for sale'), roles.map((item) => `${item.name} · **${money(guildId, item.price)}**`).join('\n'), false) : null,
    ].filter(Boolean).slice(0, 25),
  };
}

function jail({ guildId, settings }) {
  const stamina = getUpgrade('stamina');
  const bail = bailPrice(settings);
  return {
    description: t('Breaks and jail decide how often you can earn.'),
    fields: [
      field(t('🚔 Jail'), t`after a failed \`/crime\`: **${waitMinutes(settings.commands.crime.jailMinutes)}**\n${itemLabel(getItemById('insurance'))} pays the fine`
        + (bail ? t`\n🔓 bail: **${money(guildId, bail)}** (button under the jail message)` : '')),
      field(t('⛔ Locked in jail'), t('`/work` `/nagraj` `/fish` `/beg`\n`/crime` `/slut` `/rob`\n`/pozwij` `/paczka` and the casino')),
      field(t('✅ Works in jail'), t('`/daily`, the bank, `/pay`\nthe shop and upgrades')),
      field(t('⚡ Stamina'), t`**-${STAMINA_PER_LEVEL}%** of every break a level\nmax **-${STAMINA_PER_LEVEL * stamina.maxLevel}%** (level ${stamina.maxLevel})`),
      field(t('⏱️ Stamina shortens'), t('every earning command and the casino\nnot `/daily`, not jail')),
      field(t('🥤 Skip one break'), t`${itemLabel(getItemById('energy_drink'))}: \`/nagraj\`, \`/fish\`\n${itemLabel(getItemById('extra_work'))}: \`/work\``),
    ],
  };
}

function collection({ guildId }) {
  return {
    description: t`Club'o'mony cards cost money, but a legendary one is worth **${money(guildId, 15_000)} - ${money(guildId, 30_000)}**. On average a pack returns less than it costs.`,
    fields: [
      ...PACKS.map((pack) => field(
        `${pack.emoji} ${tr(pack.name)} · ${money(guildId, pack.price)}`,
        t`**${pack.cards}** {0|card|cards}\nlegendary: **${(packLegendaryChance(pack) * 100).toFixed(1)}%** a pack\nreturn on average: **${Math.round(packExpectedValue(pack) / pack.price * 100)}%**`,
      )),
      field(t('🟨 💎 Versions'), t('golden: x1.2 value\ndiamond: x1.6 value\ncards and fish')),
      field(t('📖 /index'), t`your cards and your fish (${FISH.length} species)\nsell cards or duplicates there`),
      field(t('💰 Selling'), t('a card sells for its value\nno multiplier, no Fortune')),
    ],
  };
}

function love() {
  return {
    description: t('A date at a better place costs the inviter money. Marriage joins your banks.'),
    fields: [
      field(t('💕 /randka @someone'), t`pick a place, the inviter pays\nthe pair collects hearts and levels\nonce every **${wait(DATE_COOLDOWN_MS)}** per pair`),
      field(t('💍 /slub oswiadcz'), t('the other person must accept\n**one shared bank**, separate accounts')),
      field(t('💔 /slub rozwod'), t('the shared bank is split **in half**')),
      field(t('ℹ️ /slub info'), t('your marriage and your partner')),
    ],
  };
}

function commands() {
  return {
    description: t('Every economy command in one place.'),
    fields: [
      field(t('💵 Money'), '`/hajs` `/balans`\n`/bank wplac` `/bank wyplac`\n`/pay` `/topkasa`'),
      field(t('💼 Earning'), '`/work` `/daily`\n`/nagraj` `/fish` `/beg`\n`/crime` `/slut` `/rob`\n`/pozwij`'),
      field(t('🎴 Collection'), '`/paczka` `/index`'),
      field(t('🎰 Casino'), '`/gamble` `/ruletka`\n`/slots` `/blackjack`'),
      field(t('🛒 Shop'), '`/sklep` `/ekwipunek`\n`/ulepszenia`'),
      field(t('💍 Relationships'), '`/randka` `/slub`'),
      field(t('🛠️ Admins'), '`/economy dashboard`\n`/economy poradnik`\n`/economy rola-premium`'),
    ],
  };
}

export const GUIDE_TOPICS = Object.freeze([
  { id: 'start', emoji: '🚀', name: t('First steps'), hint: t('Where to begin'), color: '#30D158', build: start },
  { id: 'zarabianie', emoji: '💼', name: t('Earning'), hint: t('Work, videos, fishing, crime'), color: '#FFD60A', build: earn },
  { id: 'bank', emoji: '🏦', name: t('Bank and robberies'), hint: t("Keep your money, take others'"), color: '#0A84FF', build: bank },
  { id: 'kasyno', emoji: '🎰', name: t('Casino'), hint: t('Games, payouts and chances'), color: '#BF5AF2', build: casino },
  { id: 'szczescie', emoji: '🍀', name: t('Luck'), hint: t('How luck raises your chance'), color: '#32D74B', build: luck },
  { id: 'ulepszenia', emoji: '⚡', name: t('Upgrades'), hint: t('Permanent bonuses and prices'), color: '#FF9F0A', build: upgrades },
  { id: 'sklep', emoji: '🛒', name: t('Shop and items'), hint: t('Tools and one-use items'), color: '#64D2FF', build: shop },
  { id: 'wiezienie', emoji: '🚔', name: t('Jail and breaks'), hint: t('Jail, Stamina, skipping a break'), color: '#FF453A', build: jail },
  { id: 'kolekcja', emoji: '🎴', name: t("Club'o'mony and /index"), hint: t('Card packs, fish, golden and diamond'), color: '#F1C40F', build: collection },
  { id: 'zwiazki', emoji: '💍', name: t('Dates and marriage'), hint: t('/randka and /slub'), color: '#FF375F', build: love },
  { id: 'komendy', emoji: '📋', name: t('All commands'), hint: t('The full list'), color: '#8E8E93', build: commands },
]);

const TOPICS_BY_ID = new Map(GUIDE_TOPICS.map((topic) => [topic.id, topic]));

/** The topic menu. `inTutorial` = inside a member's own tutorial, where it switches the topic in place. */
export function guideMenu({ selected = null, inTutorial = false } = {}) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`${GUIDE_MENU_ID}:${inTutorial ? 'zmien' : 'pokaz'}`)
    .setPlaceholder(inTutorial ? t('📖 Another topic...') : t('📖 Pick a topic...'))
    .addOptions(GUIDE_TOPICS.map((topic) => ({
      label: tr(topic.name),
      description: tr(topic.hint).slice(0, 100),
      value: topic.id,
      emoji: topic.emoji,
      default: topic.id === selected,
    }))));
}

/** The message posted in the channel: a short intro and the topic menu. */
export function buildGuideMessage(guild = null) {
  const embed = createEmbed({
    title: t('📊 Server economy'),
    description: lines(
      t('Earn money, buy upgrades, play in the casino and rob others (at your own risk).'),
      '',
      t('**Pick a topic in the menu below.** The tutorial opens just for you, nobody else sees it.'),
    ),
    fields: [
      field(t('🚀 Start'), '`/daily` · `/work`'),
      field(t('💵 Balance'), '`/hajs`'),
      field(t('🛒 Shopping'), '`/sklep` · `/ulepszenia`'),
    ],
    thumbnail: guild?.iconURL?.({ size: 128 }) ?? null,
    footer: { text: t('The tutorials always show the current server settings.') },
  });
  return { embeds: [embed], components: [guideMenu()], allowedMentions: { parse: [] } };
}

/** One tutorial, private to the member who opened it. */
export async function buildTopicView(client, guild, topicId) {
  const topic = TOPICS_BY_ID.get(topicId) ?? GUIDE_TOPICS[0];
  const settings = await getEconomySettings(guild.id);
  const leveling = await getLevelingConfig(client, guild.id).catch(() => null);
  const content = topic.build({ guildId: guild.id, guild, settings, leveling });
  const embed = createEmbed({
    title: `${topic.emoji} ${tr(topic.name)}`,
    description: content.description,
    fields: content.fields,
    color: topic.color,
    footer: { text: t('Only you can see this · pick another topic below') },
  });
  return { embeds: [embed], components: [guideMenu({ selected: topic.id, inTutorial: true })] };
}

/**
 * Post the guide message in `channel`, or edit the one posted there before.
 * Messages of the older multi-message guide are replaced.
 * @returns {Promise<{ edited: boolean }>}
 */
export async function postEconomyGuide({ guild, channel }) {
  const payload = buildGuideMessage(guild);
  const stored = await store.get(guild.id);

  const previous = [];
  if (stored.channelId === channel.id) {
    for (const id of stored.messageIds ?? []) {
      const message = await channel.messages.fetch(id).catch(() => null);
      if (message) previous.push(message);
    }
  }

  let message;
  const edited = previous.length === 1;
  if (edited) {
    [message] = previous;
    await message.edit(payload);
  } else {
    for (const old of previous) await old.delete().catch(() => null);
    message = await channel.send(payload);
  }

  await store.set(guild.id, { channelId: channel.id, messageIds: [message.id] });
  logger.info(`[ECONOMY] Economy guide ${edited ? 'edited' : 'posted'} in ${channel.id}`, { guildId: guild.id });
  return { edited };
}

export default {
  execute: withErrorHandling(async (interaction) => {
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

    const result = await postEconomyGuide({ guild: interaction.guild, channel });
    await InteractionHelper.safeEditReply(interaction, {
      embeds: [successEmbed(
        t('📊 Economy guide'),
        result.edited
          ? t`The guide in ${channel.toString()} is updated.`
          : t`The guide is posted in ${channel.toString()}. Members pick a topic from its menu and see the tutorial privately.`,
      )],
    });
  }, { command: 'economy poradnik' }),
};
