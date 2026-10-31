// "Turn reminders off" (przypomnienia:wylacz:<guildId>): under a reminder DM and in the /przypomnienia view.
// In a DM there is no guild, so the server comes from the button; a member only ever changes their own entry.

import { getEconomySettings } from '../../../services/economySettings.js';
import { getGuildLocale } from '../../../services/languageService.js';
import { buildRemindersView, getReminders, stopReminders } from '../../../services/reminders.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { runWithLocale, t } from '../../../i18n/index.js';

export default {
  name: 'przypomnienia',

  async execute(interaction, client, args = []) {
    const [, guildId] = args;
    try {
      await runWithLocale(await getGuildLocale(client, guildId), async () => {
        await stopReminders(guildId, interaction.user.id);
        if (interaction.guildId) {
          const settings = await getEconomySettings(guildId);
          const entry = (await getReminders(guildId)).members?.[interaction.user.id];
          await interaction.update(buildRemindersView({ guildId, ownerId: interaction.user.id, entry, enabled: settings.reminders?.enabled !== false }));
          return;
        }
        await interaction.update({ content: t('🔕 Reminders are off. Turn them on again with `/przypomnienia`.'), components: [] });
      });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
