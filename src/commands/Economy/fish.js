import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, earningsLine, getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import { earningMultiplier, staminaCooldown, upgradeBonusLine } from '../../services/economyUpgrades.js';
import { assertNotJailed } from '../../services/economyJail.js';
import { itemLabel, requireTool } from './modules/buy.js';
import { bestInChain } from '../../config/shop/items.js';

// A Fishing Rod (or a better rod) is needed to fish; the Carbon Rod adds +50%, the Golden Rod +100%.

const FISH_TYPES = [
    { name: t('Bass'), emoji: '🐟', rarity: 'common' },
    { name: t('Salmon'), emoji: '🐟', rarity: 'common' },
    { name: t('Trout'), emoji: '🐟', rarity: 'common' },
    { name: t('Tuna'), emoji: '🐠', rarity: 'uncommon' },
    { name: t('Swordfish'), emoji: '🐠', rarity: 'uncommon' },
    { name: t('Octopus'), emoji: '🐙', rarity: 'rare' },
    { name: t('Lobster'), emoji: '🦞', rarity: 'rare' },
    { name: t('Shark'), emoji: '🦈', rarity: 'epic' },
    { name: t('Whale'), emoji: '🐋', rarity: 'legendary' },
];

const CATCH_MESSAGES = [
    t("You cast your line into the crystal clear waters..."),
    t("You wait patiently as your bobber floats..."),
    t("After a few minutes of waiting, you feel a tug..."),
    t("The water ripples as something takes your bait..."),
    t("You reel in your catch with expert precision..."),
];

export default {
    data: new SlashCommandBuilder()
        .setName('fish')
        .setDescription('Go fishing to catch fish and earn money'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const settings = await getEconomySettings(guildId);
            const { fish } = settings.commands;
            const userData = await getEconomyData(client, guildId, userId);
            const FISH_COOLDOWN = staminaCooldown(userData, cooldownMs(fish.cooldownMinutes));
            const lastFish = userData.lastFish || 0;
            assertNotJailed(userData, now);
            await requireTool({ guild: interaction.guild, userData, toolIds: ['fishing_rod', 'carbon_rod', 'golden_rod'], action: 'fish' });

            let usedEnergyDrink = false;
            if (now < lastFish + FISH_COOLDOWN && (userData.inventory["energy_drink"] || 0) > 0) {
                userData.inventory["energy_drink"] -= 1;
                usedEnergyDrink = true;
            } else if (now < lastFish + FISH_COOLDOWN) {
                const remaining = lastFish + FISH_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor(
                    (remaining % (1000 * 60 * 60)) / (1000 * 60),
                );

                throw createError(
                    "Fishing cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You're too tired to fish right now. Rest for **${hours}h ${minutes}m** before fishing again.`,
                    { remaining, cooldownType: 'fish' }
                );
            }

            const rand = Math.random();
            let fishCaught;
            
            if (rand < 0.5) {
                
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'common')[Math.floor(Math.random() * 3)];
            } else if (rand < 0.75) {
                
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'uncommon')[Math.floor(Math.random() * 2)];
            } else if (rand < 0.9) {
                
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'rare')[Math.floor(Math.random() * 2)];
            } else if (rand < 0.98) {
                
                fishCaught = FISH_TYPES.find(f => f.rarity === 'epic');
            } else {
                
                fishCaught = FISH_TYPES.find(f => f.rarity === 'legendary');
            }

            const baseEarned = Math.floor(
                Math.random() * (fish.max - fish.min + 1)
            ) + fish.min;

            let finalEarned = baseEarned;
            let multiplierMessage = "";

            const rod = bestInChain(userData, 'fish');
            if (rod?.bonusPercent) {
                finalEarned = Math.floor(baseEarned * (1 + rod.bonusPercent / 100));
                multiplierMessage = `\n${itemLabel(rod)}: **+${rod.bonusPercent}%**`;
            }
            finalEarned = Math.floor(finalEarned * earningMultiplier(userData, 'fish'));
            multiplierMessage += upgradeBonusLine(userData, 'fish', guildId);
            if ((userData.inventory["fishing_net"] || 0) > 0) {
                userData.inventory["fishing_net"] -= 1;
                finalEarned *= 2;
                multiplierMessage += t`\n🕸️ **Fishing Net** used - double catch!`;
            }
            finalEarned = scaleEarnings(settings, finalEarned, userData);
            multiplierMessage += earningsLine(settings, userData);
            if (usedEnergyDrink) multiplierMessage += t`\n🥤 **Energy Drink** used - no break this time.`;

            const catchMessage = CATCH_MESSAGES[Math.floor(Math.random() * CATCH_MESSAGES.length)];

            userData.wallet += finalEarned;
            userData.lastFish = now;

            await setEconomyData(client, guildId, userId, userData);

            const rarityColors = {
                common: '#95A5A6',
                uncommon: '#2ECC71',
                rare: '#3498DB',
                epic: '#9B59B6',
                legendary: '#F1C40F'
            };

            const embed = createEmbed({
                title: t('Fishing Success!'),
                description: t`${catchMessage}\n\nYou caught a **${fishCaught.emoji} ${fishCaught.name}**! You sold it for **${money(guildId, finalEarned)}**!${multiplierMessage}`,
                color: rarityColors[fishCaught.rarity]
            })
                .addFields(
                    {
                        name: t("New Cash Balance"),
                        value: `${money(guildId, userData.wallet)}`,
                        inline: true,
                    },
                    {
                        name: t("Rarity"),
                        value: fishCaught.rarity.charAt(0).toUpperCase() + fishCaught.rarity.slice(1),
                        inline: true,
                    }
                )
                .setFooter({ text: t`Next fishing trip available in ${formatDuration(FISH_COOLDOWN)}.` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'fish' })
};