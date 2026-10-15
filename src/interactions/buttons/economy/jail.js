// Bail button of the jail messages (services/economyJail.js).
//   wiezienie:wykup   pay bail and leave jail at once
// Whoever presses it pays their own bail. On the presser's own message the button is
// replaced by the result; anyone else gets a private reply.

import { MessageFlags } from 'discord.js';
import { payBail } from '../../../services/economyJail.js';
import { getEconomyAccessDenial, money } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

/** True when the button sits on a reply to the presser's own command (or a private reply). */
function ownMessage(interaction) {
  const message = interaction.message;
  if (!message) return false;
  if (message.flags?.has?.(MessageFlags.Ephemeral)) return true;
  const authorId = message.interactionMetadata?.user?.id ?? message.interaction?.user?.id ?? message.mentions?.repliedUser?.id;
  return authorId === interaction.user.id;
}

export default {
  name: 'wiezienie',

  async execute(interaction, client, args = []) {
    const [action] = args;
    const { guildId, user } = interaction;

    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      if (action !== 'wykup') {
        await interaction.reply({ embeds: [infoEmbed(t('🚔 Jail'), t('This button is not available.'))], flags: MessageFlags.Ephemeral });
        return;
      }

      const result = await payBail(client, guildId, user.id);
      let embed;
      if (result.ok) {
        embed = successEmbed(t('🔓 Out of jail'), t`You paid **${money(guildId, result.price)}** bail and you are free. You can work and play again.`);
      } else if (result.reason === 'free') {
        embed = infoEmbed(t('🚔 Jail'), t('You are not in jail.'));
      } else if (result.reason === 'off') {
        embed = infoEmbed(t('🚔 Jail'), t('Bail is turned off on this server. Wait until your time is up.'));
      } else {
        embed = warningEmbed(t('🚔 Jail'), t`❌ Bail costs **${money(guildId, result.price)}** - you do not have that much (cash and bank).`);
      }

      // Own message: swap the button for the result once the member is out (or was already out).
      if (ownMessage(interaction) && (result.ok || result.reason === 'free')) {
        await interaction.update({ embeds: [embed], components: [] });
        return;
      }
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
