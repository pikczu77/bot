// Sell menu of /index (commands/Economy/modules/collection_view.js).
//   index:sprzedaj:<ownerId>  the picked card version is sold once (value = card value x version)
// Only the owner can sell; anyone else gets their own index as a private reply.

import { MessageFlags } from 'discord.js';
import { buildIndexView, decodeKey, sellCards } from '../../../commands/Economy/modules/collection_view.js';
import { getEconomyAccessDenial, getEconomySettings, money } from '../../../services/economySettings.js';
import { getEconomyData } from '../../../utils/economy.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'index',

  async execute(interaction, client, args = []) {
    const [, ownerId] = args;
    const { guildId, user } = interaction;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      await getEconomySettings(guildId);
      if (user.id !== ownerId) {
        const userData = await getEconomyData(client, guildId, user.id);
        await interaction.reply({ ...buildIndexView({ guildId, user, viewerId: user.id, userData }), flags: MessageFlags.Ephemeral });
        return;
      }

      const key = decodeKey(interaction.values?.[0]);
      const { total, count, userData } = await sellCards({ client, guildId, userId: user.id, keys: key ? [key] : [] });
      await interaction.update(buildIndexView({ guildId, user, viewerId: user.id, userData,
        notice: count ? t`💰 Sold for **${money(guildId, total)}**.` : t('This card is not in your index any more.') }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
    }
  },
};
