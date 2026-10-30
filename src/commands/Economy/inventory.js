import { SlashCommandBuilder } from 'discord.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildInventoryView, loadInventory } from './modules/inventory_view.js';

// /ekwipunek and its short twin /eq (eq.js, owner 2026-10-30): items, boosts and potions, event ranks to wear.
// The view and its tabs: modules/inventory_view.js; buttons and the rank menu: interactions/*/economy/inventory.js.
export function inventoryCommand(name) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription('Your items, boosts, potions and event ranks'),

        execute: withErrorHandling(async (interaction, config, client) => {
            const deferred = await InteractionHelper.safeDefer(interaction);
            if (!deferred) return;

            await getEconomySettings(interaction.guildId);
            const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
            const data = await loadInventory({ client, guild: interaction.guild, member });
            await InteractionHelper.safeEditReply(interaction, buildInventoryView({ user: interaction.user, ownerId: interaction.user.id, data }));
        }, { command: name }),
    };
}

export default inventoryCommand('ekwipunek');
