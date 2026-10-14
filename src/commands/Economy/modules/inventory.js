import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { shopItems } from '../../../config/shop/items.js';
import { getEconomyData } from '../../../utils/economy.js';
import { getEconomySettings } from '../../../services/economySettings.js';
import { UPGRADES, getUpgradeLevel } from '../../../services/economyUpgrades.js';
import { withErrorHandling } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { itemLabel } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your economy inventory'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await getEconomySettings(interaction.guildId);
        const userData = await getEconomyData(client, interaction.guildId, interaction.user.id);
        const inventory = userData.inventory || {};

        const items = shopItems
            .filter((item) => (inventory[item.id] || 0) > 0)
            .map((item) => `**${itemLabel(item)}:** ${inventory[item.id]}x`);

        const upgrades = UPGRADES
            .filter((upgrade) => getUpgradeLevel(userData, upgrade.id) > 0)
            .map((upgrade) => `${upgrade.emoji} ${tr(upgrade.name)} **${getUpgradeLevel(userData, upgrade.id)}/${upgrade.maxLevel}**`);

        const embed = createEmbed({
            title: t`🎒 ${interaction.user.username}'s Inventory`,
            description: items.join('\n') || t('Your inventory is currently empty.'),
            fields: [{
                name: t('⚡ Upgrades'),
                value: upgrades.join('\n') || t('None yet - see `/ulepszenia`.'),
            }],
        }).setThumbnail(interaction.user.displayAvatarURL());

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'inventory' })
};
