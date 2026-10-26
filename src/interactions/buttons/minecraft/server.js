// Buttons of /minecraft serwer (commands/Minecraft/modules/server.js), Administrator only.
//   mcserwer:start            start the server
//   mcserwer:restart|stop     ask once more
//   mcserwer:restart|stop:tak send it
//   mcserwer:kopia            make a backup now
//   mcserwer:odswiez          read the status again (also "Cancel" of the question)

import { MessageFlags } from 'discord.js';
import { buildServerView } from '../../../commands/Minecraft/modules/server.js';
import { canUseConsole } from '../../../services/minecraftConsole.js';
import { getWhitelistConfig, panelErrorText, panelOf } from '../../../services/minecraftWhitelist.js';
import { backupErrorText, createBackup, recordBackup, sendPower } from '../../../services/minecraftServer.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

const SENT = {
  start: () => t('▶️ Start sent. The server needs a moment to come up.'),
  restart: () => t('🔄 Restart sent. The server is back in a moment.'),
  stop: () => t('⏹️ Stop sent. The server is shutting down.'),
};

export default {
  name: 'mcserwer',

  async execute(interaction, client, args = []) {
    const [action, sure] = args;
    const guild = interaction.guild;
    try {
      if (!canUseConsole(interaction.member)) {
        await interaction.reply({ embeds: [warningEmbed(t('🖥️ Minecraft server'), t('Only administrators can control the server.'))], flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'odswiez') {
        await interaction.update(await buildServerView(guild));
        return;
      }
      if ((action === 'stop' || action === 'restart') && sure !== 'tak') {
        await interaction.update(await buildServerView(guild, { confirm: action }));
        return;
      }

      const config = await getWhitelistConfig(guild.id);
      const panel = panelOf(config);
      let notice;
      if (action === 'start' || action === 'stop' || action === 'restart') {
        try {
          await sendPower(panel, action);
          notice = SENT[action]();
          logger.info(`Minecraft power "${action}" by ${interaction.user.tag ?? interaction.user.id} in guild ${guild.id}`);
        } catch (error) {
          notice = `❌ ${panelErrorText(error)}`;
        }
      } else if (action === 'kopia') {
        // A backup can take a while to start on the panel: answer within Discord's 3 seconds first.
        await interaction.deferUpdate?.();
        const now = Date.now();
        try {
          const result = await createBackup(panel, { by: interaction.member?.displayName ?? interaction.user.username, now });
          await recordBackup(guild.id, { at: now, ok: true, auto: false, name: result.name });
          notice = t`💾 Backup **${result.name}** started. Big worlds take a few minutes.`;
        } catch (error) {
          notice = `❌ ${backupErrorText(error)}`;
        }
        await interaction.editReply(await buildServerView(guild, { notice }));
        return;
      } else {
        return;
      }
      await interaction.update(await buildServerView(guild, { notice }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
