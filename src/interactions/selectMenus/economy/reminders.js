// Menu of /przypomnienia (przypomnienia:wybierz:<ownerId>): saves what the member wants a DM about. Rules: services/reminders.js.

import { MessageFlags } from 'discord.js';
import { getEconomySettings } from '../../../services/economySettings.js';
import { buildRemindersView, setReminderKinds } from '../../../services/reminders.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'przypomnienia',

  async execute(interaction, client, args = []) {
    const [, ownerId] = args;
    try {
      if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: t('Use `/przypomnienia` for your own reminders.'), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferUpdate();
      const entry = await setReminderKinds({ guild: interaction.guild, user: interaction.user, kinds: interaction.values ?? [] });
      const settings = await getEconomySettings(interaction.guildId);
      await interaction.editReply(buildRemindersView({ guildId: interaction.guildId, ownerId, entry, enabled: settings.reminders?.enabled !== false }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
    }
  },
};
