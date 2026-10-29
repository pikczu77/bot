// Buttons of /prestiz (commands/Economy/prestiz.js, services/prestige.js); only the member may press them.
//   prestiz:start:<userId>  ask once more (shows what is lost)
//   prestiz:tak:<userId>    do the prestige
//   prestiz:nie:<userId>    back to the view

import { MessageFlags } from 'discord.js';
import { confirmView, prestigeView } from '../../../commands/Economy/prestiz.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { doPrestige } from '../../../services/prestige.js';
import { progressEmbeds } from '../../../services/progress.js';
import { getEconomyData } from '../../../utils/economy.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { userError } from '../../../utils/featureKit.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'prestiz',

  async execute(interaction, client, args = []) {
    const [action, userId] = args;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      if (interaction.user.id !== userId) {
        await interaction.reply({ embeds: [infoEmbed(t('⭐ Prestige'), t('This is not your prestige. Use `/prestiz`.'))], flags: MessageFlags.Ephemeral });
        return;
      }
      const guildId = interaction.guildId;
      if (action === 'start') {
        const userData = await getEconomyData(client, guildId, userId, { joint: false });
        await interaction.update(confirmView(guildId, interaction.user, userData));
        return;
      }
      if (action === 'tak') {
        const { level, progress } = await doPrestige({ client, guildId, userId, userError });
        const view = await prestigeView(client, guildId, interaction.user, { notice: t`✅ **Prestige ${level}!** Every payout is now bigger for good. Good luck from the start!` });
        await interaction.update({ ...view, embeds: [...view.embeds, ...progressEmbeds(progress, guildId)] });
        return;
      }
      await interaction.update(await prestigeView(client, guildId, interaction.user));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
