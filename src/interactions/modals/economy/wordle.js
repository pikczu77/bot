// The /wordle guess form (wordle:odp:<ownerId>): updates the private board, and posts the result
// (squares only) in the channel when the game is over.

import { MessageFlags } from 'discord.js';
import { WORDLE_MODAL, submitGuess } from '../../../commands/Economy/modules/wordle_game.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { t } from '../../../i18n/index.js';

export default {
  name: WORDLE_MODAL,

  async execute(interaction, client, args = []) {
    const [, ownerId] = args;
    try {
      if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: t('Start your own game with `/wordle`.'), flags: MessageFlags.Ephemeral });
        return;
      }
      const { board, publicPost } = await submitGuess({
        client,
        guildId: interaction.guildId,
        user: interaction.user,
        text: interaction.fields.getTextInputValue('slowo'),
      });
      if (interaction.isFromMessage?.()) await interaction.update(board);
      else await interaction.reply({ ...board, flags: MessageFlags.Ephemeral });
      if (publicPost) {
        await interaction.channel?.send(publicPost).catch((error) => logger.warn(`Wordle result not posted: ${error.message}`));
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'modal', customId: interaction.customId });
    }
  },
};
