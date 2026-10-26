// Invite picker of /napad (custom id napad:kogo:<lobbyId>), opened privately by the leader's "Invite" button.
// The invited are pinged in the channel under the lobby, and the lobby message lists them.

import { MessageFlags } from 'discord.js';
import { getLobby, getTarget, inviteToLobby, lobbyPayload } from '../../../commands/Economy/modules/heist.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { t, tr } from '../../../i18n/index.js';

export default {
  name: 'napad',

  async execute(interaction, client, args = []) {
    const [action, lobbyId] = args;
    try {
      if (action !== 'kogo') return;
      const lobby = getLobby(lobbyId);
      if (!lobby) {
        await interaction.update({ content: t('This heist is over. Start a new one with `/napad`.'), components: [] });
        return;
      }
      if (interaction.user.id !== lobby.leaderId) {
        await interaction.reply({ content: t('Only the leader invites people.'), flags: MessageFlags.Ephemeral });
        return;
      }
      const users = [...(interaction.users?.values?.() ?? [])];
      const { added } = inviteToLobby(lobby, users);
      if (!added.length) {
        await interaction.update({ content: t('Nobody new to invite: bots, people already in the crew and people already invited are skipped.'), components: [] });
        return;
      }
      const target = getTarget(lobby.targetId);
      const mentions = added.map((id) => `<@${id}>`).join(' ');
      const invite = {
        content: t`${mentions} **${lobby.leaderName}** invites you to a heist: ${target.emoji} **${tr(target.name)}**! Press "Join" under the heist message.`,
        allowedMentions: { users: added },
        ...(lobby.message?.id ? { reply: { messageReference: lobby.message.id, failIfNotExists: false } } : {}),
      };
      const channel = lobby.message?.channel ?? interaction.channel;
      if (channel?.send) {
        // Without the reply (lobby message gone) the ping still goes out.
        await channel.send(invite).catch(() => channel.send({ content: invite.content, allowedMentions: invite.allowedMentions }).catch(() => {}));
      }
      if (lobby.message?.edit) await lobby.message.edit(await lobbyPayload(lobby)).catch(() => {});
      await interaction.update({ content: t`Invited: ${mentions}`, components: [], allowedMentions: { parse: [] } });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
    }
  },
};
