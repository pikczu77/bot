import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { formatDuration } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { progressEmbeds, recordProgress } from '../../services/progress.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, earningsLine, getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import { earningMultiplier, interestPercent, upgradeBonusLine } from '../../services/economyUpgrades.js';

const PREMIUM_BONUS_PERCENTAGE = 0.1;

export default {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily cash reward'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            logger.debug(`[ECONOMY] Daily claimed started for ${userId}`, { userId, guildId });

            const settings = await getEconomySettings(guildId);
            const { daily } = settings.commands;
            const DAILY_COOLDOWN = cooldownMs(daily.cooldownMinutes);
            const DAILY_AMOUNT = daily.amount;

            const userData = await getEconomyData(client, guildId, userId);
            
            if (!userData) {
                throw createError(
                    "Failed to load economy data for daily",
                    ErrorTypes.DATABASE,
                    t("Failed to load your economy data. Please try again later."),
                    { userId, guildId }
                );
            }
            
            const lastDaily = userData.lastDaily || 0;

            if (now < lastDaily + DAILY_COOLDOWN) {
                const timeRemaining = lastDaily + DAILY_COOLDOWN - now;
                throw createError(
                    "Daily cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You need to wait before claiming daily again. Try again in **${formatDuration(timeRemaining)}**.`,
                    { timeRemaining, cooldownType: 'daily' }
                );
            }

            const guildConfig = await getGuildConfig(client, guildId);
            const PREMIUM_ROLE_ID = guildConfig.premiumRoleId;

            let earned = DAILY_AMOUNT;
            let bonusMessage = "";
            let hasPremiumRole = false;

            if (
                PREMIUM_ROLE_ID &&
                interaction.member &&
                interaction.member.roles.cache.has(PREMIUM_ROLE_ID)
            ) {
                const bonusAmount = Math.floor(
                    DAILY_AMOUNT * PREMIUM_BONUS_PERCENTAGE,
                );
                earned += bonusAmount;
                bonusMessage = t`\n✨ **Premium Bonus:** +${money(guildId, bonusAmount)}`;
                hasPremiumRole = true;
            }

            const boosted = Math.floor(earned * earningMultiplier(userData, 'daily'));
            if (boosted > earned) {
                bonusMessage += upgradeBonusLine(userData, 'daily', guildId);
                earned = boosted;
            }
            earned = scaleEarnings(settings, earned, userData);
            bonusMessage += earningsLine(settings, userData);
            // Married members share a bank view; interest is paid on their own account only.
            const ownBank = userData._joint?.ownBank ?? userData.bank ?? 0;
            const interest = Math.floor(ownBank * interestPercent(userData) / 100);
            if (interest > 0) {
                earned += interest;
                bonusMessage += t`\n📈 **Interest:** +${money(guildId, interest)} (${interestPercent(userData)}% of your bank)`;
            }

            userData.wallet = (userData.wallet || 0) + earned;
            userData.lastDaily = now;
            const progress = recordProgress(userData, { daily: 1 }, { settings, now });

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Daily claimed`, {
                userId,
                guildId,
                amount: earned,
                newWallet: userData.wallet,
                hasPremium: hasPremiumRole,
                timestamp: new Date().toISOString()
            });

            const embed = successEmbed(
                t("✅ Daily Claimed!"),
                t`You have claimed your daily **${money(guildId, earned)}**!${bonusMessage}`
            )
                .addFields({
                    name: t("New Cash Balance"),
                    value: `${money(guildId, userData.wallet)}`,
                    inline: true,
                })
                .setFooter({
                    text: hasPremiumRole
                        ? t`Next claim in ${formatDuration(DAILY_COOLDOWN)}. (Premium Active)`
                        : t`Next claim in ${formatDuration(DAILY_COOLDOWN)}.`,
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed, ...progressEmbeds(progress, guildId)] });
    }, { command: 'daily' })
};