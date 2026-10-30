// Buttons under /osiagniecia (commands/Economy/modules/progress_view.js).
//   odznaki:<t|p>:<main|event>:<page>:<userId>:<viewerId>   switch the section or the page of the list
//   odznaki:rok:event:0:<userId>:<viewerId>                 the button of the year badge (claimYearBadge), only while the server has it open
// Someone pressing another person's button gets the same list as a private reply.

import { MessageFlags } from 'discord.js';
import { buildAchievementsView, loadBadges } from '../../../commands/Economy/modules/progress_view.js';
import { progressEmbeds } from '../../../services/progress.js';
import { claimYearBadge } from '../../../services/seasonalEvents.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
  name: 'odznaki',

  async execute(interaction, client, args = []) {
    const [kind, tab, page, userId, viewerId] = args;
    const { guildId } = interaction;
    try {
      if (kind === 'rok') {
        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
        const result = await claimYearBadge({ client, guild: interaction.guild, member });
        if (result.closed || result.missing) {
          const text = result.closed ? t('This badge cannot be collected right now.') : t`You still need these ranks: ${result.missing.join(', ')}.`;
          await interaction.reply({ embeds: [warningEmbed(t('Year badge'), text)], flags: MessageFlags.Ephemeral });
          return;
        }
        const loaded = await loadBadges({ client, guildId, user: interaction.user });
        const view = buildAchievementsView({ guildId, user: interaction.user, viewerId: interaction.user.id, tab: 'event', ...loaded });
        const payload = { ...view, embeds: [...view.embeds, ...progressEmbeds(result.progress, guildId)] };
        if (interaction.user.id !== viewerId) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        else await interaction.update(payload);
        return;
      }
      const user = await client.users.fetch(userId).catch(() => null) ?? interaction.guild.members.cache.get(userId)?.user;
      if (!user) return;
      const loaded = await loadBadges({ client, guildId, user });
      const view = buildAchievementsView({ guildId, user, viewerId: interaction.user.id, tab, page: Number(page) || 0, ...loaded });
      if (interaction.user.id !== viewerId) await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
      else await interaction.update(view);
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
