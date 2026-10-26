// "Guess" under the private /wordle board (wordle:zgaduj:<ownerId>): opens the guess form.

import { MessageFlags } from 'discord.js';
import { guessModal } from '../../../commands/Economy/modules/wordle_game.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'wordle',

  async execute(interaction, client, args = []) {
    const [, ownerId] = args;
    try {
      if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: t('Start your own game with `/wordle`.'), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(guessModal(ownerId));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
