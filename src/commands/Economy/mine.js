import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, tr } from '../../i18n/index.js';
import { cooldownMs, earningsLine, getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import { earningMultiplier, staminaCooldown, takeUseInARow, upgradeBonusLine, withEconomyLock } from '../../services/economyUpgrades.js';
import { assertNotJailed } from '../../services/economyJail.js';
import { itemLabel, requireTool } from './modules/buy.js';
import { bestInChain, takeConsumable, usesInARow } from '../../config/shop/items.js';
import { againComponents } from './modules/again_button.js';

// /nagraj — the YouTuber job (was /mine until 2026-10-15; the internal id stays "mine":
// settings.commands.mine, lastMine, the "mine" upgrade and item chain, so nothing was lost).
// A Computer (or an old pickaxe) is needed; Internet adds +50%, Better Internet +100%.
// Like /fish, every video gets a rarity. The rarity sets the views and multiplies the
// base pay (a random amount between the server's min and max): common pays little,
// legendary a lot. Average over many videos ≈ the base pay.
// Cameras (second camera, camera kit, studio) give 2-4 videos in a row before the break; while
// some are left the result has a "Record again" button (modules/again_button.js).

export const VIDEO_RARITIES = [
    { id: 'common', label: t('Common'), chance: 0.50, multiplier: 0.4, views: [50, 2_000], color: '#95A5A6' },
    { id: 'uncommon', label: t('Uncommon'), chance: 0.25, multiplier: 0.8, views: [2_000, 25_000], color: '#2ECC71' },
    { id: 'rare', label: t('Rare'), chance: 0.15, multiplier: 1.5, views: [25_000, 250_000], color: '#3498DB' },
    { id: 'epic', label: t('Epic'), chance: 0.08, multiplier: 3, views: [250_000, 1_000_000], color: '#9B59B6' },
    { id: 'legendary', label: t('Legendary'), chance: 0.02, multiplier: 8, views: [1_000_000, 10_000_000], color: '#F1C40F' },
];

const VIDEOS = {
    common: [
        { emoji: '📹', title: t('Room vlog') },
        { emoji: '🧦', title: t('Sock unboxing') },
        { emoji: '🎮', title: t('Minecraft without commentary') },
    ],
    uncommon: [
        { emoji: '🛠️', title: t('Minecraft tutorial') },
        { emoji: '😂', title: t('Reacting to memes') },
    ],
    rare: [
        { emoji: '🏫', title: t('24 hours in school') },
        { emoji: '⏱️', title: t('Minecraft speedrun') },
    ],
    epic: [
        { emoji: '📅', title: t('100 days challenge') },
        { emoji: '🚗', title: t('I bought the cheapest car') },
    ],
    legendary: [
        { emoji: '🏆', title: t('#1 on Trending') },
    ],
};

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

/**
 * Roll one video. `base` is the pay before the rarity; `random` is injectable for tests.
 * @returns {{ rarity, video, views: number, pay: number }}
 */
export function rollVideo({ min, max }, random = Math.random) {
    const roll = random();
    let total = 0;
    const rarity = VIDEO_RARITIES.find((entry) => (total += entry.chance) > roll) ?? VIDEO_RARITIES[0];
    // One position inside the rarity: more views = more pay, also within the same rarity.
    const position = random();
    const [low, high] = rarity.views;
    const views = Math.round(low * (high / low) ** position);
    const base = min + Math.floor(position * (Math.max(min, max) - min + 1));
    return { rarity, video: pick(VIDEOS[rarity.id], random), views, pay: Math.floor(Math.min(base, Math.max(min, max)) * rarity.multiplier) };
}

const formatViews = (views) => String(Math.floor(views)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default {
    data: new SlashCommandBuilder()
        .setName('nagraj')
        .setDescription('Record a YouTube video and earn from its views'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
        await InteractionHelper.safeEditReply(interaction, await runRecord({ client, guild: interaction.guild, user: interaction.user }));
    }, { command: 'nagraj' })
};

/** One /nagraj for `user`. Returns the reply payload; throws a user error on a break or in jail. */
export function runRecord({ client, guild, user }) {
    return withEconomyLock(guild.id, user.id, async () => {
            const userId = user.id;
            const guildId = guild.id;
            const now = Date.now();

            const settings = await getEconomySettings(guildId);
            const { mine } = settings.commands;
            const userData = await getEconomyData(client, guildId, userId);
            const COOLDOWN = staminaCooldown(userData, cooldownMs(mine.cooldownMinutes));
            assertNotJailed(userData, now, { settings, guildId });
            await requireTool({ guild, userData, toolIds: ['pc', 'internet', 'fiber_internet'], action: 'mine' });

            const use = takeUseInARow(userData, { lastKey: 'lastMine', streakKey: 'mineStreak', cooldown: COOLDOWN, allowed: usesInARow(userData, 'cameras'), skipItem: 'energy_drink', now });
            const usedEnergyDrink = !use.blocked && use.usedItem;
            if (use.blocked) {
                const remaining = use.remaining;
                throw createError(
                    "Recording cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You are still editing your last video. Record the next one in **${formatDuration(remaining)}**.`,
                    { remaining, cooldownType: 'mine' }
                );
            }

            const { rarity, video, views: baseViews, pay } = rollVideo(mine);
            let views = baseViews;
            let finalEarned = pay;
            let multiplierMessage = "";

            const gear = bestInChain(userData, 'mine');
            if (gear?.bonusPercent) {
                finalEarned = Math.floor(finalEarned * (1 + gear.bonusPercent / 100));
                multiplierMessage = `\n${itemLabel(gear)}: **+${gear.bonusPercent}%**`;
            }

            finalEarned = Math.floor(finalEarned * earningMultiplier(userData, 'mine'));
            multiplierMessage += upgradeBonusLine(userData, 'mine', guildId);
            const thumbnail = takeConsumable(userData, 'clickbait');
            if (thumbnail) {
                finalEarned *= 2;
                views *= 2;
                multiplierMessage += t`\n**${itemLabel(thumbnail)}** used - double views and pay!`;
            }
            finalEarned = scaleEarnings(settings, finalEarned, userData);
            multiplierMessage += earningsLine(settings, userData);
            if (usedEnergyDrink) multiplierMessage += t`\n🥤 **Energy Drink** used - no break this time.`;

            userData.wallet += finalEarned;

            await setEconomyData(client, guildId, userId, userData);

            const embed = createEmbed({
                title: t('🎬 Video published!'),
                description: t`${video.emoji} **${video.title}** got **${formatViews(views)}** views.\nYou earned **${money(guildId, finalEarned)}**!${multiplierMessage}`,
                color: rarity.color,
            })
                .addFields(
                    { name: t("New Cash Balance"), value: `${money(guildId, userData.wallet)}`, inline: true },
                    { name: t("Video"), value: tr(rarity.label), inline: true },
                )
                .setFooter({ text: use.inARowLeft > 0
                    ? t`${use.inARowLeft} more in a row now, then a break of ${formatDuration(COOLDOWN)}.`
                    : t`Next video in ${formatDuration(COOLDOWN)}.` });

            return { embeds: [embed], components: againComponents('nagraj', userId, use.inARowLeft, userData) };
    });
}
