import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, getEconomySettings, money } from '../../services/economySettings.js';

const LAPTOP_MULTIPLIER = 1.5;
const WORK_JOBS = [
    t("Software Developer"),
    t("Barista"),
    t("Janitor"),
    "YouTuber",
    t("Discord Bot Developer"),
    t("Cashier"),
    t("Pizza Delivery Driver"),
    t("Librarian"),
    t("Gardener"),
    t("Data Analyst"),
];

export default {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work to earn some money'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const { work } = (await getEconomySettings(guildId)).commands;
            const WORK_COOLDOWN = cooldownMs(work.cooldownMinutes);

            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Failed to load economy data for work",
                    ErrorTypes.DATABASE,
                    t("Failed to load your economy data. Please try again later."),
                    { userId, guildId }
                );
            }

            logger.debug(`[ECONOMY] Work command started for ${userId}`, { userId, guildId });

            const lastWork = userData.lastWork || 0;
            const inventory = userData.inventory || {};
            const extraWorkShifts = inventory["extra_work"] || 0;
            const hasLaptop = inventory["laptop"] || 0;

            let cooldownActive = now < lastWork + WORK_COOLDOWN;
            let usedConsumable = false;

            if (cooldownActive) {
                if (extraWorkShifts > 0) {
                    inventory["extra_work"] = (inventory["extra_work"] || 0) - 1;
                    usedConsumable = true;
                } else {
                    const remaining = lastWork + WORK_COOLDOWN - now;
                    throw createError(
                        "Work cooldown active",
                        ErrorTypes.RATE_LIMIT,
                        t`You're working too fast! Wait **${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m** before working again.`,
                        { timeRemaining: remaining, cooldownType: 'work' }
                    );
                }
            }

            let earned = Math.floor(Math.random() * (work.max - work.min + 1)) + work.min;
            const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];

            let multiplierMessage = "";
            if (hasLaptop > 0) {
                earned = Math.floor(earned * LAPTOP_MULTIPLIER);
                multiplierMessage = t("\n💻 **Laptop Bonus:** +50% earnings!");
            }

            userData.wallet = (userData.wallet || 0) + earned;
            userData.lastWork = now;

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Work completed`, {
                userId,
                guildId,
                amount: earned,
                job,
                usedConsumable,
                hasLaptop: hasLaptop > 0,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const embed = successEmbed(
                t("💼 Work Complete!"),
                t`You worked as a **${job}** and earned **${money(guildId, earned)}**!${multiplierMessage}`
            )
                .addFields(
                    {
                        name: t("New Balance"),
                        value: `${money(guildId, userData.wallet)}`,
                        inline: true,
                    },
                    {
                        name: t("Next Work"),
                        value: `<t:${Math.floor((now + WORK_COOLDOWN) / 1000)}:R>`,
                        inline: true,
                    }
                )
                .setFooter({
                    text: t`Requested by ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL(),
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'work' })
};