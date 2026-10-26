// Answer buttons of a quiz question (quiz:<questionId>:<position>), services/quiz.js.
// A wrong answer or a second try is answered privately; the winner's click updates the question.

import { MessageFlags } from 'discord.js';
import { answerQuestion } from '../../../services/quiz.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'quiz',

  async execute(interaction, client, args = []) {
    const [questionId, position] = args;
    try {
      const result = await answerQuestion({ client, guild: interaction.guild, user: interaction.user, questionId, position });
      if (result.update) await interaction.update(result.update);
      else await interaction.reply({ content: result.reply, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
