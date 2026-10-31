// Letter menus of /wisielec (wisielec:litera:<gameId>:<1|2>), services/hangman.js.

import { MessageFlags } from 'discord.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { playLetter } from '../../../services/hangman.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'wisielec',

  async execute(interaction, client, args = []) {
    const [, gameId] = args;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ content: denial, flags: MessageFlags.Ephemeral });
        return;
      }
      const result = await playLetter({ client, guild: interaction.guild, user: interaction.user, gameId, letter: interaction.values?.[0] });
      if (result.update) await interaction.update(result.update);
      else await interaction.reply({ content: result.reply, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
    }
  },
};
