import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, buildUserErrorEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, getEconomySettings, money } from '../../services/economySettings.js';

export default {
    data: new SlashCommandBuilder()
        .setName('rob')
        .setDescription('Attempt to rob another user (very risky)')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to rob')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const robberId = interaction.user.id;
            const victimUser = interaction.options.getUser("user");
            const guildId = interaction.guildId;
            const now = Date.now();

            if (robberId === victimUser.id) {
                throw createError(
                    "Cannot rob self",
                    ErrorTypes.VALIDATION,
                    t("You cannot rob yourself."),
                    { robberId, victimId: victimUser.id }
                );
            }
            
            if (victimUser.bot) {
                throw createError(
                    "Cannot rob bot",
                    ErrorTypes.VALIDATION,
                    t("You cannot rob a bot."),
                    { victimId: victimUser.id, isBot: true }
                );
            }

            const { rob } = (await getEconomySettings(guildId)).commands;
            const ROB_COOLDOWN = cooldownMs(rob.cooldownMinutes);

            const robberData = await getEconomyData(client, guildId, robberId);
            const victimData = await getEconomyData(client, guildId, victimUser.id);
            
            if (!robberData || !victimData) {
                throw createError(
                    "Failed to load economy data",
                    ErrorTypes.DATABASE,
                    t("Failed to load economy data. Please try again later."),
                    { robberId: !!robberData, victimId: !!victimData, guildId }
                );
            }
            
            const lastRob = robberData.lastRob || 0;

            if (now < lastRob + ROB_COOLDOWN) {
                const remaining = lastRob + ROB_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

                throw createError(
                    "Robbery cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You need to lay low. Wait **${hours}h ${minutes}m** before attempting another robbery.`,
                    { remaining, hours, minutes, cooldownType: 'rob' }
                );
            }

            if (victimData.wallet < rob.minVictimCash) {
                throw createError(
                    "Victim too poor",
                    ErrorTypes.VALIDATION,
                    t`${victimUser.username} is too poor. They need at least ${money(guildId, rob.minVictimCash)} cash to be worth robbing.`,
                    { victimWallet: victimData.wallet, required: rob.minVictimCash }
                );
            }

            const hasSafe = victimData.inventory["personal_safe"] || 0;

            if (hasSafe > 0) {
                robberData.lastRob = now;
                await setEconomyData(client, guildId, robberId, robberData);

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            t('Robbery Blocked'),
                            t`${victimUser.username} was prepared! Your attempt failed because they own a **Personal Safe**. You got away clean but didn't gain anything.`
                        )
                    ],
                });
            }

            const isSuccessful = Math.random() * 100 < rob.successPercent;
            let resultEmbed;

            if (isSuccessful) {
                const amountStolen = Math.floor(victimData.wallet * rob.stealPercent / 100);

                robberData.wallet = (robberData.wallet || 0) + amountStolen;
                victimData.wallet = (victimData.wallet || 0) - amountStolen;

                resultEmbed = successEmbed(
                    t('Robbery Successful'),
                    t`You successfully stole **${money(guildId, amountStolen)}** from ${victimUser.username}!`
                );
            } else {
                const fineAmount = Math.floor((robberData.wallet || 0) * rob.finePercent / 100);

                if ((robberData.wallet || 0) < fineAmount) {
                    robberData.wallet = 0;
                } else {
                    robberData.wallet = (robberData.wallet || 0) - fineAmount;
                }

                resultEmbed = buildUserErrorEmbed(
                    'unknown',
                    t`You failed the robbery and were caught! You were fined **${money(guildId, fineAmount)}** of your own cash.`,
                    { titleOverride: t('Robbery Failed') }
                );
            }

            robberData.lastRob = now;

            await setEconomyData(client, guildId, robberId, robberData);
            await setEconomyData(client, guildId, victimUser.id, victimData);

            resultEmbed
                .addFields(
                    {
                        name: t`Your New Cash (${interaction.user.username})`,
                        value: `${money(guildId, robberData.wallet)}`,
                        inline: true,
                    },
                    {
                        name: t`Victim's New Cash (${victimUser.username})`,
                        value: `${money(guildId, victimData.wallet)}`,
                        inline: true,
                    },
                )
                .setFooter({ text: t`Next robbery available in ${formatDuration(ROB_COOLDOWN)}.` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'rob' })
};