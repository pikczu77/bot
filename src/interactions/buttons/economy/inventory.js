// Tab buttons of /ekwipunek and /eq (commands/Economy/modules/inventory_view.js).
//   ekwipunek:tab:<ownerId>:<tab>   switch to przedmioty | boosty | eventowe
// Someone pressing another member's button gets their own inventory as a private reply.

import { MessageFlags } from 'discord.js';
import { buildInventoryView, inventoryTab, loadInventory } from '../../../commands/Economy/modules/inventory_view.js';
import { getEconomyAccessDenial, getEconomySettings } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'ekwipunek',

  async execute(interaction, client, args = []) {
    const [, ownerId, tab] = args;
    const { guild, user } = interaction;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      await getEconomySettings(guild.id);
      const member = interaction.member ?? await guild.members.fetch(user.id);
      const data = await loadInventory({ client, guild, member });
      const view = buildInventoryView({ user, ownerId: user.id, tab: inventoryTab(tab), data });
      if (user.id !== ownerId) await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
      else await interaction.update(view);
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
