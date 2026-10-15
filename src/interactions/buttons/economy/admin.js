// Buttons of /economy gracz (commands/Economy/modules/economy_admin.js). Only members with
// Manage Server (the right /economy needs) can use them.

import { MessageFlags } from 'discord.js';
import { buildAdminView, isEconomyAdmin, runAdminAction } from '../../../commands/Economy/modules/economy_admin.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'ekoadmin',

  async execute(interaction, client, args = []) {
    const [action, userId] = args;
    const { guildId } = interaction;
    try {
      if (!isEconomyAdmin(interaction)) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), t('You need the Manage Server permission for this.'))], flags: MessageFlags.Ephemeral });
        return;
      }
      const user = await client.users.fetch(userId);

      if (action === 'reset' || action === 'ulepszenia') {
        const question = action === 'reset'
          ? t`⚠️ Reset the money of **${user.username}**? Cash and bank go back to the server's starting amounts. This cannot be undone.`
          : t`⚠️ Remove every upgrade of **${user.username}**? This cannot be undone.`;
        await interaction.update(await buildAdminView({ client, guildId, user, notice: question, confirm: action }));
        return;
      }

      const run = { 'reset-tak': 'reset', 'ulepszenia-tak': 'ulepszenia', wypusc: 'wypusc' }[action];
      const notice = run ? await runAdminAction({ client, guildId, userId, action: run }) : '';
      await interaction.update(await buildAdminView({ client, guildId, user, notice }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
