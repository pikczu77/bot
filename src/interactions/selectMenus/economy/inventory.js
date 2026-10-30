// Rank menu of /ekwipunek and /eq, tab "eventowe" (commands/Economy/modules/inventory_view.js).
//   ekwipunek:ranga:<ownerId>   wear the picked event rank (value '<eventId>:<year>') or none ('none'); one at a time
// Only the owner can pick; anyone else gets their own inventory as a private reply.

import { MessageFlags } from 'discord.js';
import { buildInventoryView, loadInventory } from '../../../commands/Economy/modules/inventory_view.js';
import { getEconomyAccessDenial, getEconomySettings } from '../../../services/economySettings.js';
import { wearRank } from '../../../services/seasonalEvents.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { userError } from '../../../utils/featureKit.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'ekwipunek',

  async execute(interaction, client, args = []) {
    const [, ownerId] = args;
    const { guild, user } = interaction;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      await getEconomySettings(guild.id);
      const member = interaction.member ?? await guild.members.fetch(user.id);
      if (user.id !== ownerId) {
        const data = await loadInventory({ client, guild, member });
        await interaction.reply({ ...buildInventoryView({ user, ownerId: user.id, tab: 'eventowe', data }), flags: MessageFlags.Ephemeral });
        return;
      }

      let notice;
      try {
        const worn = await wearRank({ client, guild, member, key: interaction.values?.[0] ?? 'none', userError });
        notice = worn ? t`✅ You wear <@&${worn.role.id}> now.` : t('✅ You wear no event rank now.');
      } catch (error) {
        if (!error?.userMessage) throw error;
        notice = `❌ ${error.userMessage}`;
      }
      const data = await loadInventory({ client, guild, member });
      await interaction.update(buildInventoryView({ user, ownerId, tab: 'eventowe', data, notice }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
    }
  },
};
