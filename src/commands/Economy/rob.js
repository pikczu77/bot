import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, buildUserErrorEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, getEconomySettings, money } from '../../services/economySettings.js';
import { bankStealPercent, robSuccessBonus, staminaCooldown } from '../../services/economyUpgrades.js';
import { assertNotJailed } from '../../services/economyJail.js';

const LOCKPICK_BONUS = 20;
const MAX_SUCCESS_PERCENT = 95;

/** Take one `itemId` from the inventory. Returns true when there was one. */
function useItem(userData, itemId) {
    const count = userData.inventory?.[itemId] || 0;
    if (count <= 0) return false;
    userData.inventory = { ...userData.inventory, [itemId]: count - 1 };
    return true;
}

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

            assertNotJailed(robberData, now, { settings: await getEconomySettings(guildId), guildId });
            const ROB_COOLDOWN = staminaCooldown(robberData, cooldownMs(rob.cooldownMinutes));
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

            const victimWallet = victimData.wallet || 0;
            const victimBank = victimData.bank || 0;

            if (victimWallet + victimBank < rob.minVictimCash) {
                throw createError(
                    "Victim too poor",
                    ErrorTypes.VALIDATION,
                    t`${victimUser.username} is too poor. They need at least ${money(guildId, rob.minVictimCash)} (cash and bank) to be worth robbing.`,
                    { victimWallet, victimBank, required: rob.minVictimCash }
                );
            }

            robberData.lastRob = now;

            if (useItem(victimData, 'personal_safe')) {
                await setEconomyData(client, guildId, robberId, robberData);
                await setEconomyData(client, guildId, victimUser.id, victimData);

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            t('Robbery Blocked'),
                            t`${victimUser.username} had a **Personal Safe**. It stopped you and broke. You got away clean but didn't gain anything.`
                        )
                    ],
                });
            }

            const usedLockpick = useItem(robberData, 'lockpick');
            const successPercent = Math.min(
                Math.max(MAX_SUCCESS_PERCENT, rob.successPercent),
                rob.successPercent + robSuccessBonus(robberData) + (usedLockpick ? LOCKPICK_BONUS : 0),
            );
            const isSuccessful = Math.random() * 100 < successPercent;
            let resultEmbed;

            if (isSuccessful) {
                const bankPercent = bankStealPercent(victimData);
                const fromWallet = Math.floor(victimWallet * rob.stealPercent / 100);
                const fromBank = Math.floor(victimBank * bankPercent / 100);
                const amountStolen = fromWallet + fromBank;

                robberData.wallet = (robberData.wallet || 0) + amountStolen;
                victimData.wallet = victimWallet - fromWallet;
                victimData.bank = victimBank - fromBank;

                resultEmbed = successEmbed(
                    t('Robbery Successful'),
                    t`You stole **${money(guildId, amountStolen)}** from ${victimUser.username}!` +
                    t`\n💵 Cash: ${money(guildId, fromWallet)} (${rob.stealPercent}%)\n🏦 Bank: ${money(guildId, fromBank)} (${bankPercent}%)`
                );
            } else {
                const fineAmount = Math.floor((robberData.wallet || 0) * rob.finePercent / 100);
                const insured = fineAmount > 0 && useItem(robberData, 'insurance');

                if (!insured) robberData.wallet = Math.max(0, (robberData.wallet || 0) - fineAmount);

                resultEmbed = buildUserErrorEmbed(
                    'unknown',
                    insured
                        ? t`You failed the robbery and were caught! Your **Insurance** paid the fine of **${money(guildId, fineAmount)}**.`
                        : t`You failed the robbery and were caught! You were fined **${money(guildId, fineAmount)}** of your own cash.`,
                    { titleOverride: t('Robbery Failed') }
                );
            }

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
                .setFooter({
                    text: usedLockpick
                        ? t`Lockpick used: ${successPercent}% success chance. Next robbery in ${formatDuration(ROB_COOLDOWN)}.`
                        : t`Success chance: ${successPercent}%. Next robbery in ${formatDuration(ROB_COOLDOWN)}.`,
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'rob' })
};
