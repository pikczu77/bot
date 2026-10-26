// Buttons of /wymiana (commands/Economy/modules/trade.js).
//   wymiana:ok:<offerId>      only the partner: accept and swap
//   wymiana:nie:<offerId>     only the partner: decline
//   wymiana:anuluj:<offerId>  only the author: withdraw

import { MessageFlags } from 'discord.js';
import { acceptOffer, closeOffer, getOffer } from '../../../commands/Economy/modules/trade.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

const privately = (interaction, text) => interaction.reply({ embeds: [infoEmbed(t('🤝 Trade'), text)], flags: MessageFlags.Ephemeral });

export default {
  name: 'wymiana',

  async execute(interaction, client, args = []) {
    const [action, offerId] = args;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      const offer = getOffer(offerId);
      if (!offer) {
        await interaction.update({ components: [] }).catch(() => {});
        await interaction.followUp({ embeds: [infoEmbed(t('🤝 Trade'), t('This offer has expired. Start a new one with `/wymiana`.'))], flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      if (action === 'anuluj') {
        if (interaction.user.id !== offer.fromId) return privately(interaction, t('Only the author can withdraw this offer.'));
        await interaction.update(closeOffer(offer, 'withdrawn'));
        return;
      }
      if (interaction.user.id !== offer.toId) return privately(interaction, t('This offer is not for you. Use `/wymiana` to make your own.'));
      if (action === 'nie') {
        await interaction.update(closeOffer(offer, 'declined'));
        return;
      }
      if (action === 'ok') {
        const result = await acceptOffer({ client, offer });
        if (result) await interaction.update(result);
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
