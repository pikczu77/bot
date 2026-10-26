// /blackjack and its buttons (bj:<action>:<ownerId>). The hand is saved in the member's
// economy data as `blackjack`; the bet is taken when the game starts. Rules and odds:
// src/services/blackjack.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getEconomySettings, money } from '../../../services/economySettings.js';
import { withEconomyLock } from '../../../services/economyUpgrades.js';
import { checkBet, formatChance, luckLines, takeLuck } from '../../../services/casino.js';
import { GAME_TIMEOUT_MS, bustChance, deal, dealerPlay, handValue, hit, isBlackjack, settle, standOdds } from '../../../services/blackjack.js';
import { getItemById } from '../../../config/shop/items.js';
import { t } from '../../../i18n/index.js';
import { progressEmbeds, recordProgress } from '../../../services/progress.js';
import { eventLuck } from '../../../services/economyEvents.js';

const showHand = (cards) => cards.map((card) => `\`${card}\``).join(' ');

/** Luck of the game in the shape luckLines() reads. */
const gameLuck = (game) => ({
  upgrade: game.luck?.upgrade ?? 0,
  clover: getItemById(game.luck?.cloverId) ?? null,
  item: getItemById(game.luck?.itemId) ?? null,
  event: game.luck?.event ?? 0,
  total: game.luck?.total ?? 0,
});

const RESULT_TITLES = {
  blackjack: () => t('🃏 Blackjack! You won'),
  win: () => t('🃏 Blackjack - you won'),
  push: () => t('🃏 Blackjack - draw'),
  lose: () => t('🃏 Blackjack - you lost'),
};

function buildView({ guildId, user, userData, game, result = null, notice = '' }) {
  const playing = !result;
  const player = handValue(game.player);
  const dealer = handValue(game.dealer);
  const luck = gameLuck(game);

  const lines = [notice, t`Bet: **${money(guildId, game.bet)}**${game.doubled ? t(' (doubled)') : ''}`];
  if (game.saves > 0) lines.push(t`🍀 Luck saved you from busting ${game.saves}x.`);
  if (result) {
    const text = {
      blackjack: t`Blackjack! You get **${money(guildId, result.payout)}** (3:2).`,
      win: t`You get **${money(guildId, result.payout)}**.`,
      push: t`Your bet of **${money(guildId, result.payout)}** comes back.`,
      lose: player.total > 21 ? t`Bust - over 21. You lost **${money(guildId, game.bet)}**.` : t`The dealer wins. You lost **${money(guildId, game.bet)}**.`,
    }[result.outcome];
    lines.push(`**${text}**`);
  }

  let footer;
  if (playing) {
    const odds = standOdds(game.player, game.dealer[0]);
    footer = t`🎯 If you stand now: ${formatChance(odds.win)}% win · ${formatChance(odds.push)}% draw\n💥 If you draw a card: ${formatChance(bustChance(game.player, luck.total))}% risk of busting`;
  } else if (game.stood) {
    footer = t`🎯 Your win chance when you stood: ${formatChance(game.stood.win)}% (draw ${formatChance(game.stood.push)}%)`;
  } else {
    footer = player.total > 21 ? t('🎯 Your win chance: 0% - bust') : t('🎯 Decided by the first two cards');
  }
  if (luck.total > 0) footer += t`\n🍀 Luck +${luck.total}%: chance that a busting card is swapped`;

  const embed = createEmbed({
    title: playing ? t('🃏 Blackjack') : RESULT_TITLES[result.outcome](),
    description: lines.filter(Boolean).join('\n') + luckLines(luck),
    color: playing ? 'primary' : result.outcome === 'lose' ? 'error' : result.outcome === 'push' ? 'warning' : 'success',
    fields: [
      { name: t`You - ${player.total}`, value: showHand(game.player), inline: true },
      playing
        ? { name: t`Dealer - ${handValue([game.dealer[0]]).total}`, value: `${showHand([game.dealer[0]])} \`❓\``, inline: true }
        : { name: t`Dealer - ${dealer.total > 21 ? t('bust') : dealer.total}`, value: showHand(game.dealer), inline: true },
      { name: t("New Cash Balance"), value: money(guildId, userData.wallet || 0), inline: false },
    ],
    footer: { text: footer },
    thumbnail: user.displayAvatarURL?.() ?? null,
  });

  if (!playing) return { embeds: [embed], components: [] };

  const canDouble = game.player.length === 2 && !game.doubled && (userData.wallet || 0) >= game.bet;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bj:dobierz:${user.id}`).setLabel(t('Hit')).setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bj:stoj:${user.id}`).setLabel(t('Stand')).setEmoji('✋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bj:podwoj:${user.id}`).setLabel(t('Double')).setEmoji('💰').setStyle(ButtonStyle.Secondary).setDisabled(!canDouble),
  );
  return { embeds: [embed, ...progressEmbeds(result?.progress ?? null, guildId)], components: [row] };
}

/** Finish the hand: the dealer plays (unless the player busted), the wallet gets the payout. */
function finish(userData, game, { stand, settings }) {
  if (stand) {
    game.stood = standOdds(game.player, game.dealer[0]);
    dealerPlay(game);
  }
  const result = settle(game);
  userData.wallet = (userData.wallet || 0) + result.payout;
  userData.blackjack = null;
  result.progress = recordProgress(userData, {
    casino: 1,
    casinoWin: ['win', 'blackjack'].includes(result.outcome) ? 1 : 0,
    blackjackNatural: result.outcome === 'blackjack' ? 1 : 0,
  }, { settings });
  return result;
}

/** /blackjack: start a hand, or show the one still being played. */
export function startBlackjack({ client, guildId, user, bet }) {
  return withEconomyLock(guildId, user.id, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const now = Date.now();
    let notice = '';

    const running = userData.blackjack;
    if (running?.player) {
      if (now - (running.startedAt || 0) < GAME_TIMEOUT_MS) {
        return buildView({ guildId, user, userData, game: running, notice: t('You already have a game - finish it first.') });
      }
      // Left alone for too long: it stands on what it has.
      const old = finish(userData, running, { stand: true, settings });
      notice = t`Your previous hand stood on its own: ${old.player} against ${old.dealer > 21 ? t('bust') : old.dealer} (+${money(guildId, old.payout)}).`;
    }

    checkBet({ settings, userData, bet, guildId, now });
    const luck = takeLuck(userData, eventLuck(settings, now));
    const game = {
      ...deal(bet),
      startedAt: now,
      luck: { upgrade: luck.upgrade, cloverId: luck.clover?.id ?? null, itemId: luck.item?.id ?? null, event: luck.event, total: luck.total },
    };
    userData.wallet -= bet;
    userData.lastGamble = now;

    let result = null;
    if (isBlackjack(game.player) || isBlackjack(game.dealer)) result = finish(userData, game, { stand: false, settings });
    else userData.blackjack = game;

    await setEconomyData(client, guildId, user.id, userData);
    return buildView({ guildId, user, userData, game, result, notice });
  });
}

/** A button: 'dobierz' (hit), 'stoj' (stand), 'podwoj' (double down). Null when no game is running. */
export function playBlackjack({ client, guildId, user, action }) {
  return withEconomyLock(guildId, user.id, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const game = userData.blackjack;
    if (!game?.player) return null;

    let result = null;
    const luck = game.luck?.total ?? 0;
    if (action === 'podwoj') {
      if (game.player.length !== 2 || game.doubled || (userData.wallet || 0) < game.bet) {
        throw createError("Cannot double", ErrorTypes.VALIDATION,
          t('You can double only on your first move and with enough cash for a second bet.'), { expected: true });
      }
      userData.wallet -= game.bet;
      game.bet *= 2;
      game.doubled = true;
      hit(game, luck);
      result = finish(userData, game, { stand: handValue(game.player).total <= 21, settings });
    } else if (action === 'dobierz') {
      hit(game, luck);
      const { total } = handValue(game.player);
      if (total > 21) result = finish(userData, game, { stand: false, settings });
      else if (total === 21) result = finish(userData, game, { stand: true, settings });
    } else {
      result = finish(userData, game, { stand: true, settings });
    }

    if (!result) userData.blackjack = game;
    await setEconomyData(client, guildId, user.id, userData);
    return buildView({ guildId, user, userData, game, result });
  });
}
