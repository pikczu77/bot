// "Work again" / "Fish again" / "Record again" (commands/Economy/modules/again_button.js).
//   ponownie:<work|fish|nagraj>:<ownerId>
// The result replaces the message. Only the owner can press it; a break or jail answers privately.

import { MessageFlags } from 'discord.js';
import { runWork } from '../../../commands/Economy/modules/work_shift.js';
import { runFish } from '../../../commands/Economy/fish.js';
import { runRecord } from '../../../commands/Economy/mine.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

const RUN = {
  work: ({ client, interaction }) => runWork({ client, guildId: interaction.guildId, user: interaction.user }),
  fish: ({ client, interaction }) => runFish({ client, guild: interaction.guild, user: interaction.user }),
  nagraj: ({ client, interaction }) => runRecord({ client, guild: interaction.guild, user: interaction.user }),
};

export default {
  name: 'ponownie',

  async execute(interaction, client, args = []) {
    const [kind, ownerId] = args;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      if (interaction.user.id !== ownerId || !RUN[kind]) {
        await interaction.reply({ embeds: [infoEmbed(t('Economy'), t('This button is for someone else. Use the command yourself.'))], flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.update(await RUN[kind]({ client, interaction }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
