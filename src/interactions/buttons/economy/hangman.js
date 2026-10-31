// "I know the password" under a /wisielec game (wisielec:haslo:<gameId>): opens the form. services/hangman.js.

import { MessageFlags } from 'discord.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { passwordModal, runningGame } from '../../../services/hangman.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { t } from '../../../i18n/index.js';

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
      const game = runningGame(interaction.guildId);
      if (!game || game.id !== gameId) {
        await interaction.reply({ content: t('This game is over. Start a new one with `/wisielec`.'), flags: MessageFlags.Ephemeral });
        return;
      }
      if (game.passwordTried.has(interaction.user.id)) {
        await interaction.reply({ content: t('You already tried the password in this game. You can still pick letters.'), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(passwordModal(gameId));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
