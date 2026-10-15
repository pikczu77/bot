// "Remove one upgrade" menu of /economy gracz (commands/Economy/modules/economy_admin.js).
//   ekoadmin:ulepszenie:<userId>  the picked upgrade is removed completely

import { MessageFlags } from 'discord.js';
import { buildAdminView, isEconomyAdmin, runAdminAction } from '../../../commands/Economy/modules/economy_admin.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'ekoadmin',

  async execute(interaction, client, args = []) {
    const [, userId] = args;
    const { guildId } = interaction;
    try {
      if (!isEconomyAdmin(interaction)) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), t('You need the Manage Server permission for this.'))], flags: MessageFlags.Ephemeral });
        return;
      }
      const user = await client.users.fetch(userId);
      const notice = await runAdminAction({ client, guildId, userId, action: 'ulepszenie', upgradeId: interaction.values?.[0] });
      await interaction.update(await buildAdminView({ client, guildId, user, notice }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
    }
  },
};
