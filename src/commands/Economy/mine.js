import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { cooldownMs, getEconomySettings, money } from '../../services/economySettings.js';
import { earningMultiplier, staminaCooldown, upgradeBonusLine } from '../../services/economyUpgrades.js';
import { requireTool } from './modules/buy.js';

// A Pickaxe (or the Diamond Pickaxe) is needed to mine; the Diamond Pickaxe also doubles the find.
const DIAMOND_PICKAXE_MULTIPLIER = 2.0;

const MINE_LOCATIONS = [
    t("abandoned gold mine"),
    t("dark, damp cave"),
    t("backyard rock quarry"),
    t("volcanic obsidian vent"),
    t("deep-sea mineral trench"),
];

export default {
    data: new SlashCommandBuilder()
        .setName('mine')
        .setDescription('Go mining to earn money'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const { mine } = (await getEconomySettings(guildId)).commands;
            const userData = await getEconomyData(client, guildId, userId);
            const MINE_COOLDOWN = staminaCooldown(userData, cooldownMs(mine.cooldownMinutes));
            const lastMine = userData.lastMine || 0;
            const hasDiamondPickaxe = userData.inventory["diamond_pickaxe"] || 0;
            await requireTool({ guild: interaction.guild, userData, toolIds: ['pickaxe', 'diamond_pickaxe'], action: 'mine' });

            let usedEnergyDrink = false;
            if (now < lastMine + MINE_COOLDOWN && (userData.inventory["energy_drink"] || 0) > 0) {
                userData.inventory["energy_drink"] -= 1;
                usedEnergyDrink = true;
            } else if (now < lastMine + MINE_COOLDOWN) {
                const remaining = lastMine + MINE_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor(
                    (remaining % (1000 * 60 * 60)) / (1000 * 60),
                );

                throw createError(
                    "Mining cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`Your pickaxe is cooling down. Wait for **${hours}h ${minutes}m** before mining again.`,
                    { remaining, cooldownType: 'mine' }
                );
            }

            const baseEarned =
                Math.floor(
                    Math.random() * (mine.max - mine.min + 1),
                ) + mine.min;

            let finalEarned = baseEarned;
            let multiplierMessage = "";

            if (hasDiamondPickaxe > 0) {
                finalEarned = Math.floor(baseEarned * DIAMOND_PICKAXE_MULTIPLIER);
                multiplierMessage = t`\n💎 **Diamond Pickaxe Bonus: +100%**`;
            }

            finalEarned = Math.floor(finalEarned * earningMultiplier(userData, 'mine'));
            multiplierMessage += upgradeBonusLine(userData, 'mine');
            if (usedEnergyDrink) multiplierMessage += t`\n🥤 **Energy Drink** used - no break this time.`;

            const location =
                MINE_LOCATIONS[
                    Math.floor(Math.random() * MINE_LOCATIONS.length)
                ];

            userData.wallet += finalEarned;
userData.lastMine = now;

            await setEconomyData(client, guildId, userId, userData);

            const embed = successEmbed(
                t("💰 Mining Expedition Successful!"),
                t`You explored a **${location}** and managed to find minerals worth **${money(guildId, finalEarned)}**!${multiplierMessage}`,
            )
                .addFields({
                    name: t("New Cash Balance"),
                    value: `${money(guildId, userData.wallet)}`,
                    inline: true,
                })
                .setFooter({ text: t`Next mine available in ${formatDuration(MINE_COOLDOWN)}.` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'mine' })
};