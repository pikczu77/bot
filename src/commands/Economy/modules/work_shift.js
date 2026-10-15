// /work and the job offer buttons: show 3 job offers, sign a contract, work a shift.
// Shared by src/commands/Economy/work.js and src/interactions/buttons/economy/jobs.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { cooldownMs, earningsLine, getEconomySettings, money, scaleEarnings } from '../../../services/economySettings.js';
import { earningMultiplier, staminaCooldown, upgradeBonusLine, withEconomyLock, workShiftsInARow } from '../../../services/economyUpgrades.js';
import { JOBS, JOB_SHIFTS, activeJob, ensureOffers, getServerLevel, randomPay, takeJob } from '../../../services/economyJobs.js';
import { assertNotJailed } from '../../../services/economyJail.js';
import { bestInChain } from '../../../config/shop/items.js';
import { itemLabel } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

/** What one shift pays on top of the job's base pay: best work tool × Career. scaleEarnings adds the server multiplier and Fortune. */
function payFactor(userData) {
    const tool = bestInChain(userData, 'work');
    return (1 + (tool?.bonusPercent ?? 0) / 100) * earningMultiplier(userData, 'work');
}

function offersView({ guildId, settings, userData, user, level, offers }) {
    const factor = payFactor(userData);
    const pay = (amount) => money(guildId, scaleEarnings(settings, Math.floor(amount * factor), userData));
    const next = JOBS.find((job) => job.level > level);

    const embed = createEmbed({
        title: t`💼 Job offers · level ${level}`,
        description: [
            t`📊 Your server level: **${level}**. Pick one of the offers - the higher your level, the better the jobs.`,
            t`A job lasts **${JOB_SHIFTS} shifts** of \`/work\`, then you get new offers.`,
            next
                ? t`-# 🔒 Next: ${next.emoji} ${tr(next.name)} from level ${next.level} (${pay(next.min)} - ${pay(next.max)}), ${next.level - level} {5|level|levels} to go`
                : t('-# 👑 You can get the best jobs.'),
        ].join('\n'),
        fields: offers.map((job) => ({
            name: `${job.emoji} ${tr(job.name)}`,
            value: t`**${pay(job.min)} - ${pay(job.max)}** per shift\n-# from level ${job.level}`,
            inline: true,
        })),
        footer: { text: t('Pay shown with your bonuses (items, upgrades, server multiplier).') },
        thumbnail: user.displayAvatarURL?.() ?? null,
    });

    const row = new ActionRowBuilder().addComponents(offers.map((job) => new ButtonBuilder()
        .setCustomId(`praca:wybierz:${user.id}:${job.id}`)
        .setLabel(tr(job.name).slice(0, 80))
        .setEmoji(job.emoji)
        .setStyle(ButtonStyle.Primary)));

    return { embeds: [embed], components: [row] };
}

/**
 * Work one shift of `job`. Mutates `userData`. Throws a user error while the member is on a break.
 * @returns {{ earned: number, extras: string, ended: boolean, nextAt: number|null, inARowLeft: number }}
 */
export function workShift({ settings, userData, job, guildId, now = Date.now(), random = Math.random }) {
    assertNotJailed(userData, now, { settings, guildId });
    const cooldown = staminaCooldown(userData, cooldownMs(settings.commands.work.cooldownMinutes));
    const allowed = workShiftsInARow(userData);
    const lastWork = userData.lastWork || 0;
    // Shifts since the last full break; members who worked before jobs existed count as 1.
    let streak = now >= lastWork + cooldown ? 0 : (Number.isInteger(userData.workStreak) ? userData.workStreak : 1);

    let extras = '';
    if (streak >= allowed) {
        if ((userData.inventory?.extra_work || 0) <= 0) {
            const remaining = lastWork + cooldown - now;
            throw createError(
                "Work cooldown active",
                ErrorTypes.RATE_LIMIT,
                t`You're working too fast! Wait **${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m** before working again.`,
                { timeRemaining: remaining, cooldownType: 'work', expected: true }
            );
        }
        userData.inventory = { ...userData.inventory, extra_work: userData.inventory.extra_work - 1 };
        extras += t`\n⏱️ **Extra Work Shift** used - no break this time.`;
    } else {
        streak += 1;
    }

    const tool = bestInChain(userData, 'work');
    const earned = scaleEarnings(settings, Math.floor(randomPay(job, random) * payFactor(userData)), userData);
    if (tool?.bonusPercent) extras = t`\n${itemLabel(tool)}: **+${tool.bonusPercent}%**` + extras;
    extras += upgradeBonusLine(userData, 'work', guildId) + earningsLine(settings, userData);

    userData.wallet = (userData.wallet || 0) + earned;
    userData.lastWork = now;
    userData.workStreak = streak;
    userData.job = { id: job.id, shiftsLeft: Math.max(0, (userData.job?.shiftsLeft || 1) - 1) };
    const ended = userData.job.shiftsLeft === 0;
    if (ended) {
        userData.job = null;
        userData.jobOffers = [];
    }

    const inARowLeft = Math.max(0, allowed - streak);
    return { earned, extras, ended, nextAt: inARowLeft > 0 ? null : now + cooldown, inARowLeft, shiftsLeft: userData.job?.shiftsLeft ?? 0 };
}

function shiftView({ guildId, userData, user, job, result, notice = '' }) {
    const description = [
        notice,
        t`You worked as a **${tr(job.name)}** and earned **${money(guildId, result.earned)}**!${result.extras}`,
        result.ended ? t('📄 **Contract finished.** Your next `/work` brings new job offers.') : '',
    ].filter(Boolean).join('\n\n');

    const nextWork = result.nextAt === null
        ? t`now - ${result.inARowLeft} more in a row`
        : `<t:${Math.floor(result.nextAt / 1000)}:R>`;

    return {
        embeds: [successEmbed(t("💼 Work Complete!"), description).addFields(
            { name: t("New Balance"), value: money(guildId, userData.wallet), inline: true },
            { name: t("Next Work"), value: nextWork, inline: true },
            { name: t('Contract'), value: result.ended ? t('finished') : t`${job.emoji} ${result.shiftsLeft}/${JOB_SHIFTS} shifts left`, inline: true },
        ).setFooter({ text: t`Requested by ${user.tag ?? user.username}`, iconURL: user.displayAvatarURL?.() })],
        components: [],
    };
}

/** /work: offers when the member has no job, otherwise one shift. Returns the reply payload. */
export function runWork({ client, guildId, user }) {
    return withEconomyLock(guildId, user.id, async () => {
        const settings = await getEconomySettings(guildId);
        const userData = await getEconomyData(client, guildId, user.id);
        assertNotJailed(userData, Date.now(), { settings, guildId });
        const job = activeJob(userData);

        if (!job) {
            const level = await getServerLevel(client, guildId, user.id);
            const offers = ensureOffers(userData, level);
            await setEconomyData(client, guildId, user.id, userData);
            return offersView({ guildId, settings, userData, user, level, offers });
        }

        const result = workShift({ settings, userData, job, guildId });
        await setEconomyData(client, guildId, user.id, userData);
        logger.info('[ECONOMY_TRANSACTION] Work completed', { userId: user.id, guildId, amount: result.earned, job: job.id, newWallet: userData.wallet });
        return shiftView({ guildId, userData, user, job, result });
    });
}

/**
 * A click on a job offer: sign the contract and work the first shift when no break is due.
 * Returns the payload for the offers message, or null when the offer is gone.
 */
export function chooseJob({ client, guildId, user, jobId }) {
    return withEconomyLock(guildId, user.id, async () => {
        const settings = await getEconomySettings(guildId);
        const userData = await getEconomyData(client, guildId, user.id);
        if (activeJob(userData)) return null;
        const job = takeJob(userData, jobId);
        if (!job) return null;

        const hired = t`✅ You took the job **${job.emoji} ${tr(job.name)}** for ${JOB_SHIFTS} shifts.`;
        try {
            const result = workShift({ settings, userData, job, guildId });
            await setEconomyData(client, guildId, user.id, userData);
            return shiftView({ guildId, userData, user, job, result, notice: hired });
        } catch (error) {
            if (!['work', 'jail'].includes(error?.context?.cooldownType)) throw error;
            await setEconomyData(client, guildId, user.id, userData);
            return {
                embeds: [successEmbed(t('💼 Job taken'), `${hired}\n\n${error.userMessage}`)],
                components: error.context?.components ?? [],
            };
        }
    });
}
