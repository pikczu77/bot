// Buttons under /osiagniecia (commands/Economy/modules/progress_view.js).
//   odznaki:<t|p>:<main|event>:<page>:<userId>:<viewerId>   switch the section or the page of the list
//   odznaki:rok:event:0:<userId>:<viewerId>                 the "2026" button: the presser gets the "Year 2026" badge
// Someone pressing another person's button gets the same list as a private reply.

import { MessageFlags } from 'discord.js';
import { buildAchievementsView, claimYearBadge, loadBadges } from '../../../commands/Economy/modules/progress_view.js';
import { progressEmbeds } from '../../../services/progress.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'odznaki',

  async execute(interaction, client, args = []) {
    const [kind, tab, page, userId, viewerId] = args;
    const { guildId } = interaction;
    try {
      if (kind === 'rok') {
        const progress = await claimYearBadge({ client, guildId, user: interaction.user });
        const { settings, userData } = await loadBadges({ client, guildId, user: interaction.user });
        const view = buildAchievementsView({ guildId, settings, user: interaction.user, userData, viewerId: interaction.user.id, tab: 'event' });
        const payload = { ...view, embeds: [...view.embeds, ...progressEmbeds(progress, guildId)] };
        if (interaction.user.id !== viewerId) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        else await interaction.update(payload);
        return;
      }
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
