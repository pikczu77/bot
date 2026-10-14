import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import { earningMultiplier, staminaCooldown } from '../../services/economyUpgrades.js';
import { assertNotJailed } from '../../services/economyJail.js';

const SLUT_ACTIVITIES = [
    { name: t("Cam Stream"), min: 120, max: 450, risk: 0.2 },
    { name: t("Private Dance Session"), min: 220, max: 700, risk: 0.25 },
    { name: t("After-Hours Club Host"), min: 320, max: 900, risk: 0.3 },
    { name: t("VIP Companion Booking"), min: 550, max: 1400, risk: 0.35 },
    { name: t("Exclusive Livestream"), min: 850, max: 2200, risk: 0.4 },
];

const POSITIVE_OUTCOMES = [
    t("Your stream blew up and tips poured in."),
    t("A VIP booking paid far above average."),
    t("Your after-hours shift was packed and profitable."),
    t("Premium requests came through and your payout jumped."),
];

const FINE_OUTCOMES = [
    t("Venue security issued a compliance fine."),
    t("A moderation strike triggered a platform fee."),
    t("You were flagged and had to pay a penalty."),
];

const ROBBED_OUTCOMES = [
    t("A fake buyer chargeback wiped part of your earnings."),
    t("A scam booking cleaned out a chunk of your cash."),
    t("You got baited by a fraud account and lost money."),
];

const LOSS_OUTCOMES = [
    t("The set flopped and you had to cover operating costs."),
    t("You burned budget on prep and made no return."),
    t("The shift went sideways and left you in the red."),
];

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function resolveOutcome(activity, wallet) {
    const successChance = Math.max(0.35, 0.55 - activity.risk * 0.2);
    const fineChance = 0.22;
    const robbedChance = 0.2;
    const roll = Math.random();

    if (roll < successChance) {
        const amount = randomInt(activity.min, activity.max);
        return {
            type: 'payout',
            delta: amount,
            message: randomChoice(POSITIVE_OUTCOMES),
            title: t`${activity.name} - Payout`
        };
    }

    const remainingAfterSuccess = roll - successChance;

    if (remainingAfterSuccess < fineChance) {
        const maxFine = Math.min(wallet, Math.max(150, Math.floor(activity.max * 0.4)));
        const minFine = Math.min(maxFine, Math.max(50, Math.floor(activity.min * 0.2)));
        const amount = maxFine > 0 ? randomInt(minFine, maxFine) : 0;
        return {
            type: 'fine',
            delta: -amount,
            message: randomChoice(FINE_OUTCOMES),
            title: t`${activity.name} - Fined`
        };
    }

    if (remainingAfterSuccess < fineChance + robbedChance) {
        const maxRobbed = Math.min(wallet, Math.max(200, Math.floor(wallet * 0.35)));
        const minRobbed = Math.min(maxRobbed, Math.max(75, Math.floor(wallet * 0.1)));
        const amount = maxRobbed > 0 ? randomInt(minRobbed, maxRobbed) : 0;
        return {
            type: 'robbed',
            delta: -amount,
            message: randomChoice(ROBBED_OUTCOMES),
            title: t`${activity.name} - Robbed`
        };
    }

    const maxLoss = Math.min(wallet, Math.max(100, Math.floor(activity.max * 0.3)));
    const minLoss = Math.min(maxLoss, Math.max(40, Math.floor(activity.min * 0.15)));
    const amount = maxLoss > 0 ? randomInt(minLoss, maxLoss) : 0;
    return {
        type: 'loss',
        delta: -amount,
        message: randomChoice(LOSS_OUTCOMES),
        title: t`${activity.name} - Loss`
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('slut')
        .setDescription('Take a risky provocative job for random payout or loss'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            logger.debug(`[ECONOMY] Slut command started for ${userId}`, { userId, guildId });

            const economySettings = await getEconomySettings(guildId);
            const settings = economySettings.commands.slut;
            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Failed to load economy data for slut command",
                    ErrorTypes.DATABASE,
                    t("Failed to load your economy data. Please try again later."),
                    { userId, guildId }
                );
            }

            assertNotJailed(userData, now);
            const SLUT_COOLDOWN = staminaCooldown(userData, cooldownMs(settings.cooldownMinutes));
            const lastSlut = userData.lastSlut || 0;

            if (now - lastSlut < SLUT_COOLDOWN) {
                const remainingTime = lastSlut + SLUT_COOLDOWN - now;
                throw createError(
                    "Slut cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You need to wait before you can work again! Try again in **${Math.ceil(remainingTime / 60000)}** minutes.`,
                    { timeRemaining: remainingTime, cooldownType: 'slut' }
                );
            }

            const baseActivity = randomChoice(SLUT_ACTIVITIES);
            const scale = settings.payoutPercent / 100 * earningMultiplier(userData, 'crime');
            const activity = { ...baseActivity, min: Math.floor(baseActivity.min * scale), max: Math.floor(baseActivity.max * scale) };

            const outcome = resolveOutcome(activity, userData.wallet || 0);
            if (outcome.type === 'payout') outcome.delta = scaleEarnings(economySettings, outcome.delta, userData);

            userData.lastSlut = now;
            userData.totalSluts = (userData.totalSluts || 0) + 1;
            userData.totalSlutEarnings = (userData.totalSlutEarnings || 0) + Math.max(0, outcome.delta);
            userData.totalSlutLosses = (userData.totalSlutLosses || 0) + Math.max(0, -outcome.delta);

            if (outcome.type !== 'payout') {
                userData.failedSluts = (userData.failedSluts || 0) + 1;
            }

            userData.wallet = Math.max(0, (userData.wallet || 0) + outcome.delta);

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Slut activity resolved`, {
                userId,
                guildId,
                activity: activity.name,
                outcomeType: outcome.type,
                amountDelta: outcome.delta,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const amountLabel = `${outcome.delta >= 0 ? '+' : '-'}${money(guildId, Math.abs(outcome.delta))}`;
            const summaryLines = [
                `${outcome.message}`,
                t`💸 **Net Result:** ${amountLabel}`,
                t`💳 **Current Balance:** ${money(guildId, userData.wallet)}`,
                t`📊 **Total Sessions:** ${userData.totalSluts}`,
                t`💵 **Total Earned:** ${money(guildId, (userData.totalSlutEarnings || 0))}`,
                t`🧾 **Total Lost:** ${money(guildId, (userData.totalSlutLosses || 0))}`
            ];

            const embed = createEmbed({
                title: outcome.title,
                description: summaryLines.join('\n'),
                color: outcome.delta >= 0 ? 'success' : 'error',
                timestamp: true
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'slut' })
};