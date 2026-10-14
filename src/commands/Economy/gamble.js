import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, getEconomySettings, money } from '../../services/economySettings.js';
import { gambleWinBonus } from '../../services/economyUpgrades.js';

const CLOVER_WIN_BONUS = 0.1;
const CHARM_WIN_BONUS = 0.08;

export default {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Gamble your money for a chance to win more')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of cash to gamble')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const betAmount = interaction.options.getInteger("amount");
            const now = Date.now();

            const { gamble } = (await getEconomySettings(guildId)).commands;
            const GAMBLE_COOLDOWN = cooldownMs(gamble.cooldownMinutes);
            const BASE_WIN_CHANCE = gamble.winPercent / 100;

            if (gamble.maxBet > 0 && betAmount > gamble.maxBet) {
                throw createError(
                    "Bet above the limit",
                    ErrorTypes.VALIDATION,
                    t`The highest bet on this server is ${money(guildId, gamble.maxBet)}.`,
                    { betAmount, maxBet: gamble.maxBet }
                );
            }

            const userData = await getEconomyData(client, guildId, userId);
            const lastGamble = userData.lastGamble || 0;
            let cloverCount = userData.inventory["lucky_clover"] || 0;
            let charmCount = userData.inventory["lucky_charm"] || 0;

            if (now < lastGamble + GAMBLE_COOLDOWN) {
                const remaining = lastGamble + GAMBLE_COOLDOWN - now;
                const minutes = Math.floor(remaining / (1000 * 60));
                const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

                throw createError(
                    "Gamble cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You need to cool down before gambling again. Wait **${minutes}m ${seconds}s**.`,
                    { remaining, cooldownType: 'gamble' }
                );
            }

            if (userData.wallet < betAmount) {
                throw createError(
                    "Insufficient cash for gamble",
                    ErrorTypes.VALIDATION,
                    t`You only have ${money(guildId, userData.wallet)} cash, but you are trying to bet ${money(guildId, betAmount)}.`,
                    { required: betAmount, current: userData.wallet }
                );
            }

            let winChance = BASE_WIN_CHANCE + gambleWinBonus(userData) / 100;
            let cloverMessage = "";
            let usedClover = false;
            let usedCharm = false;

            if (cloverCount > 0) {
                winChance += CLOVER_WIN_BONUS;
                userData.inventory["lucky_clover"] -= 1;
                cloverMessage = t`\n🍀 **Lucky Clover Consumed:** Your win chance was boosted!`;
                usedClover = true;
            }
            
            else if (charmCount > 0) {
                winChance += CHARM_WIN_BONUS;
                userData.inventory["lucky_charm"] -= 1;
                cloverMessage = t`\n🍀 **Lucky Charm Used (${charmCount - 1} uses remaining):** Your win chance was boosted!`;
                usedCharm = true;
            }

            winChance = Math.min(winChance, 0.95);
            const win = Math.random() < winChance;
            let cashChange = 0;
            let resultEmbed;

            if (win) {
                const amountWon = Math.floor(betAmount * gamble.payoutPercent / 100);
                // Net change: the bet is replaced by the payout (bet was at stake, not pre-deducted)
                cashChange = amountWon - betAmount;

                resultEmbed = successEmbed(
                    t("🎉 You Won!"),
                    t`You successfully gambled and turned your **${money(guildId, betAmount)}** bet into **${money(guildId, amountWon)}**!${cloverMessage}`,
                );
            } else {
cashChange = -betAmount;

                resultEmbed = warningEmbed(
                    t("💔 You Lost..."),
                    t`The dice rolled against you. You lost your **${money(guildId, betAmount)}** bet.`,
                );
            }

            userData.wallet = (userData.wallet || 0) + cashChange;
userData.lastGamble = now;

            await setEconomyData(client, guildId, userId, userData);

            const newCash = userData.wallet;

            resultEmbed.addFields({
                name: t("New Cash Balance"),
                value: `${money(guildId, newCash)}`,
                inline: true,
            });

            if (usedClover) {
                resultEmbed.setFooter({
                    text: t`You have ${userData.inventory["lucky_clover"]} Lucky Clovers left. Win chance was ${Math.round(winChance * 100)}%.`,
                });
            } else if (usedCharm) {
                resultEmbed.setFooter({
                    text: t`You have ${userData.inventory["lucky_charm"]} Lucky Charm uses left. Win chance was ${Math.round(winChance * 100)}%.`,
                });
            } else {
                resultEmbed.setFooter({
                    text: t`Next gamble available in ${formatDuration(GAMBLE_COOLDOWN)}. Base win chance: ${Math.round(BASE_WIN_CHANCE * 100)}%.`,
                });
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'gamble' })
};