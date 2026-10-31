// The password form of /wisielec (wisielec:odp:<gameId>): updates the game message. services/hangman.js.

import { MessageFlags } from 'discord.js';
import { playPassword } from '../../../services/hangman.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'wisielec',

  async execute(interaction, client, args = []) {
    const [, gameId] = args;
    try {
      const result = await playPassword({
        client,
        guild: interaction.guild,
        user: interaction.user,
        gameId,
        text: interaction.fields.getTextInputValue('haslo'),
      });
      if (result.update) await interaction.update(result.update);
      else await interaction.reply({ content: result.reply, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'modal', customId: interaction.customId });
    }
  },
};
