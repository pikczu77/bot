import { Events, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { recordLeave } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.user?.bot) return;

    let leave;
    try {
      leave = await recordLeave(member);
    } catch (error) {
      logger.debug(`Invite leave tracking failed: ${error.message}`);
      return;
    }

    const channelId = leave.config?.enabled ? leave.config.logChannelId : null;
    if (!channelId) return;

    const channel = member.guild.channels.cache.get(channelId);
    const me = member.guild.members.me;
    if (!channel?.isTextBased?.() || !channel.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return;
    }

    const detail = leave.inviter
      ? t`Invited by ${leave.inviter}, who now has **${leave.stats?.total ?? 0}** {1|invite|invites}.`
      : t('I do not know who invited them.');

    await channel.send({
      embeds: [createEmbed({
        author: { name: member.user.tag, iconURL: member.user.displayAvatarURL() },
        description: `📤 ${member.user} ${t('left the server.')}\n${detail}`,
        color: 'error',
        footer: false,
        timestamp: true,
      })],
      allowedMentions: { parse: [] },
    }).catch((error) => logger.debug(`Invite log message failed: ${error.message}`));
  },
};
