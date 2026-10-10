import { Events, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { resolveMemberJoin } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

function describeSource(join) {
  if (join.type === 'bot') return t('Added as a bot (OAuth).');
  if (join.type === 'vanity') return t`Joined through the server's custom link \`${join.code}\`.`;
  if (join.inviter) {
    const count = join.stats?.total ?? 0;
    return [
      t`Invited by ${join.inviter} (\`${join.code}\`).`,
      join.fake
        ? t`⚠️ New account — not counted. They still have **${count}** {0|invite|invites}.`
        : t`They now have **${count}** {0|invite|invites}.`,
    ].join('\n');
  }
  return t('I could not tell which invite was used.');
}

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const join = await resolveMemberJoin(member);
    const channelId = join.config?.enabled ? join.config.logChannelId : null;
    if (!channelId) return;

    const channel = member.guild.channels.cache.get(channelId);
    const me = member.guild.members.me;
    if (!channel?.isTextBased?.() || !channel.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return;
    }

    const lines = [describeSource(join)];
    if (join.rewards?.length) {
      lines.push(t`🎖️ ${join.inviter} earned ${join.rewards.map((role) => role.toString()).join(', ')}!`);
    }

    await channel.send({
      embeds: [createEmbed({
        author: { name: member.user.tag, iconURL: member.user.displayAvatarURL() },
        description: `📥 ${member} ${t('joined the server.')}\n${lines.join('\n')}`,
        color: join.fake ? 'warning' : 'success',
        footer: false,
        timestamp: true,
      })],
      allowedMentions: { parse: [] },
    }).catch((error) => logger.debug(`Invite log message failed: ${error.message}`));
  },
};
