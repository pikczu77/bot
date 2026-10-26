// Buttons of /napad (commands/Economy/modules/heist.js).
//   napad:dolacz:<id>   join
//   napad:zapros:<id>   leader only: private member picker for invites
//   napad:start:<id>    leader only: start
//   napad:wyjdz:<id>    leave; the leader cancels

import { MessageFlags } from 'discord.js';
import {
  getLobby, heistTiming, inviteMenu, joinLobby, leaveLobby, startHeist,
} from '../../../commands/Economy/modules/heist.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

const privately = (interaction, text) => interaction.reply({ embeds: [infoEmbed(t('🦹 Heist'), text)], flags: MessageFlags.Ephemeral });
const wait = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export default {
  name: 'napad',

  async execute(interaction, client, args = []) {
    const [action, lobbyId] = args;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      const lobby = getLobby(lobbyId);
      if (!lobby) {
        await interaction.update({ components: [] }).catch(() => {});
        await interaction.followUp({ embeds: [infoEmbed(t('🦹 Heist'), t('This heist is over. Start a new one with `/napad`.'))], flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (interaction.message && !lobby.message) lobby.message = interaction.message;
      const name = interaction.member?.displayName ?? interaction.user.username;
      const leader = interaction.user.id === lobby.leaderId;

      try {
        if (action === 'dolacz') {
          await interaction.update(await joinLobby({ client, lobby, user: interaction.user, name }));
        } else if (action === 'wyjdz') {
          await interaction.update(await leaveLobby({ lobby, userId: interaction.user.id }));
        } else if (action === 'zapros') {
          if (!leader) return privately(interaction, t('Only the leader invites people. Press "Join" to go yourself.'));
          await interaction.reply({ content: t('Pick up to 4 people. They get pinged in the channel.'), components: inviteMenu(lobby), flags: MessageFlags.Ephemeral });
        } else if (action === 'start') {
          if (!leader) return privately(interaction, t('Only the leader starts the heist.'));
          const outcome = await startHeist({ client, lobby });
          if (!outcome.started) {
            await interaction.update(outcome.payload);
            return;
          }
          if (heistTiming.suspenseMs > 0) {
            await interaction.update(outcome.running);
            await wait(heistTiming.suspenseMs);
            await interaction.editReply(outcome.result);
          } else {
            await interaction.update(outcome.result);
          }
        }
      } catch (error) {
        if (error?.userMessage && error.context?.expected) return privately(interaction, error.userMessage);
        throw error;
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
