import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { bestInChain, shopItems } from '../../config/shop/items.js';
import { JOB_SHIFTS, activeJob } from '../../services/economyJobs.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { UPGRADES, getUpgradeLevel } from '../../services/economyUpgrades.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { itemLabel } from './modules/buy.js';
import { t, tr } from '../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName('ekwipunek')
        .setDescription('View your economy inventory'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await getEconomySettings(interaction.guildId);
        const userData = await getEconomyData(client, interaction.guildId, interaction.user.id);
        const inventory = userData.inventory || {};

        // Of each tier line only the best owned item is shown - it is the one that works.
        const items = shopItems
            .filter((item) => (inventory[item.id] || 0) > 0)
            .filter((item) => !item.chain || bestInChain(userData, item.chain)?.id === item.id)
            .map((item) => (item.type === 'tool' && !item.stackable
                ? `**${itemLabel(item)}**${item.bonusPercent ? ` · +${item.bonusPercent}%` : ''}`
                : `**${itemLabel(item)}:** ${inventory[item.id]}x`));
        const job = activeJob(userData);

        const upgrades = UPGRADES
            .filter((upgrade) => getUpgradeLevel(userData, upgrade.id) > 0)
            .map((upgrade) => `${upgrade.emoji} ${tr(upgrade.name)} **${getUpgradeLevel(userData, upgrade.id)}/${upgrade.maxLevel}**`);

        const embed = createEmbed({
            title: t`🎒 ${interaction.user.username}'s Inventory`,
            description: items.join('\n') || t('Your inventory is currently empty.'),
            fields: [{
                name: t('⚡ Upgrades'),
                value: upgrades.join('\n') || t('None yet - see `/ulepszenia`.'),
            }, {
                name: t('💼 Job'),
                value: job ? t`${job.emoji} ${tr(job.name)} · ${userData.job.shiftsLeft}/${JOB_SHIFTS} shifts left` : t('None - `/work` shows job offers.'),
            }],
        }).setThumbnail(interaction.user.displayAvatarURL());

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'ekwipunek' })
};
