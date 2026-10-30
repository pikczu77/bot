// Buttons under /profil (profil:odznaki|misje:<userId>): the full badge list or the missions of that
// member, as a private reply. Anyone may look; only the owner can swap missions there.

import { MessageFlags } from 'discord.js';
import { buildAchievementsView, loadBadges, showMissions } from '../../../commands/Economy/modules/progress_view.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'profil',

  async execute(interaction, client, args = []) {
    const [action, userId] = args;
    try {
      const user = await client.users.fetch(userId).catch(() => null) ?? interaction.guild.members.cache.get(userId)?.user;
      if (!user) return;
      const guildId = interaction.guildId;
      if (action === 'misje') {
        const view = await showMissions({ client, guildId, user, viewerId: interaction.user.id });
        await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
        return;
      }
      const loaded = await loadBadges({ client, guildId, user });
      await interaction.reply({ ...buildAchievementsView({ guildId, user, viewerId: interaction.user.id, ...loaded }), flags: MessageFlags.Ephemeral });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
