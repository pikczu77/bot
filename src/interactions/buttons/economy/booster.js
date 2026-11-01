// "My boost" under the info message of the boosts channel (booster:status, services/serverBoost.js `boostInfoMessage`).
// Private answer, the same view as /booster info. No economy channel rules: it only shows the presser's own status.

import { MessageFlags } from 'discord.js';
import { buildBoosterView } from '../../../commands/Economy/booster.js';
import { getEconomySettings } from '../../../services/economySettings.js';
import { getBoostData } from '../../../services/serverBoost.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'booster',

  async execute(interaction) {
    try {
      const { guild, member } = interaction;
      const settings = await getEconomySettings(guild.id);
      const { members } = await getBoostData(guild.id);
      await interaction.reply({ embeds: [buildBoosterView({ guild, member, settings, entry: members?.[member.id] })], flags: MessageFlags.Ephemeral });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
