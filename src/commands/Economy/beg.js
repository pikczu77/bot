import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import { staminaCooldown } from '../../services/economyUpgrades.js';
import { assertNotJailed } from '../../services/economyJail.js';

export default {
    data: new SlashCommandBuilder()
        .setName('beg')
        .setDescription('Beg for a small amount of money'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;

            const settings = await getEconomySettings(guildId);
            const { beg } = settings.commands;
            let userData = await getEconomyData(client, guildId, userId);
            const COOLDOWN = staminaCooldown(userData, cooldownMs(beg.cooldownMinutes));
            
            if (!userData) {
                throw createError(
                    "Failed to load economy data",
                    ErrorTypes.DATABASE,
                    t("Failed to load your economy data. Please try again later."),
                    { userId, guildId }
                );
            }

            assertNotJailed(userData, Date.now(), { settings, guildId });
            const lastBeg = userData.lastBeg || 0;
            const remainingTime = lastBeg + COOLDOWN - Date.now();

            if (remainingTime > 0) {
                const minutes = Math.floor(remainingTime / 60000);
                const seconds = Math.floor((remainingTime % 60000) / 1000);

                let timeMessage =
                    minutes > 0 ? t`${minutes} minute(s)` : t`${seconds} second(s)`;

                throw createError(
                    "Beg cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You are tired from begging! Try again in **${timeMessage}**.`,
                    { remainingTime, minutes, seconds, cooldownType: 'beg' }
                );
            }

            const success = Math.random() * 100 < beg.successPercent;

            let replyEmbed;
            let newCash = userData.wallet;

            if (success) {
                const amountWon = scaleEarnings(settings,
                    Math.floor(Math.random() * (beg.max - beg.min + 1)) + beg.min, userData);

                newCash += amountWon;

                const successMessages = [
                    t`A kind stranger drops **${money(guildId, amountWon)}** into your cup.`,
                    t`You spotted an unattended wallet! You grab **${money(guildId, amountWon)}** and run.`,
                    t`Someone took pity on you and gave you **${money(guildId, amountWon)}**!`,
                    t`You found **${money(guildId, amountWon)}** under a park bench.`,
                ];

                replyEmbed = successEmbed(
                    t('Begging Successful'),
                    successMessages[
                        Math.floor(Math.random() * successMessages.length)
                    ]
                );
            } else {
                const failMessages = [
                    t("The police chased you off. You got nothing."),
                    t("Someone yelled, 'Get a job!' and walked past."),
                    t("A squirrel stole the single coin you had."),
                    t("You tried to beg, but you were too embarrassed and gave up."),
                ];

                replyEmbed = warningEmbed(
                    t('Insufficient Funds'),
                    failMessages[Math.floor(Math.random() * failMessages.length)]
                );
            }

            userData.wallet = newCash;
userData.lastBeg = Date.now();

            await setEconomyData(client, guildId, userId, userData);

            await InteractionHelper.safeEditReply(interaction, { embeds: [replyEmbed] });
    }, { command: 'beg' })
};