// Buttons under /osiagniecia (commands/Economy/modules/progress_view.js).
//   odznaki:<t|p>:<main|event>:<page>:<userId>:<viewerId>   switch the section or the page of the list
// Someone pressing another person's button gets the same list as a private reply.

import { MessageFlags } from 'discord.js';
import { buildAchievementsView, loadBadges } from '../../../commands/Economy/modules/progress_view.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'odznaki',

  async execute(interaction, client, args = []) {
    const [, tab, page, userId, viewerId] = args;
    const { guildId } = interaction;
    try {
      const user = await client.users.fetch(userId).catch(() => null) ?? interaction.guild.members.cache.get(userId)?.user;
      if (!user) return;
      const { settings, userData } = await loadBadges({ client, guildId, user });
      const view = buildAchievementsView({ guildId, settings, user, userData, viewerId: interaction.user.id, tab, page: Number(page) || 0 });
      if (interaction.user.id !== viewerId) await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
      else await interaction.update(view);
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
