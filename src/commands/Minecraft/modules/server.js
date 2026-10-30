// /minecraft serwer — server status with Start / Restart / Stop and "Backup now" buttons (Administrator).
// Service: src/services/minecraftServer.js. Buttons: src/interactions/buttons/minecraft/server.js (mcserwer:*).
// Stop and Restart ask once more before they are sent (players get disconnected).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { requirePermission, userError } from '../../../utils/featureKit.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { getWhitelistConfig, panelErrorText, panelOf } from '../../../services/minecraftWhitelist.js';
import { listBackups, serverStatus } from '../../../services/minecraftServer.js';
import { t } from '../../../i18n/index.js';

export const SERVER_BUTTON = 'mcserwer';

export function serverSubcommand(sub) {
  return sub
    .setName('serwer')
    .setDescription('Minecraft server status with start, restart, stop and backup buttons (Administrator)');
}

/** "1.2 GB", "512 MB" */
export function size(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}

/** "2 d 3 h", "5 h 12 min", "8 min" */
export function span(ms) {
  const minutes = Math.floor((Number(ms) || 0) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`;
}

const STATES = {
  running: () => t('🟢 On'),
  starting: () => t('🟡 Starting'),
  stopping: () => t('🟠 Shutting down'),
  offline: () => t('🔴 Off'),
};

const stamp = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

function lastBackupLine(config) {
  const last = config.lastBackup;
  if (!last?.at) return t('no backup from Discord yet');
  return last.ok
    ? t`last: ${stamp(last.at)}${last.auto ? t(' (automatic)') : ''}`
    : t`last try ${stamp(last.at)} failed: ${last.error ?? '?'}`;
}

export const scheduleText = (hours) => (hours > 0 ? t`every **${hours} h**` : t('off'));

function serverButtons(status, { confirm = null, disabled = false } = {}) {
  if (confirm) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${SERVER_BUTTON}:${confirm}:tak`).setStyle(ButtonStyle.Danger)
        .setLabel(confirm === 'stop' ? t('Yes, stop the server') : t('Yes, restart the server')),
      new ButtonBuilder().setCustomId(`${SERVER_BUTTON}:odswiez`).setStyle(ButtonStyle.Secondary).setLabel(t('Cancel')),
    )];
  }
  const state = status?.state ?? 'offline';
  const off = disabled || !status || status.suspended;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${SERVER_BUTTON}:start`).setStyle(ButtonStyle.Success).setEmoji('▶️').setLabel(t('Start'))
        .setDisabled(off || state === 'running' || state === 'starting'),
      new ButtonBuilder().setCustomId(`${SERVER_BUTTON}:restart`).setStyle(ButtonStyle.Primary).setEmoji('🔄').setLabel(t('Restart'))
        .setDisabled(off || state === 'offline'),
      new ButtonBuilder().setCustomId(`${SERVER_BUTTON}:stop`).setStyle(ButtonStyle.Danger).setEmoji('⏹️').setLabel(t('Stop'))
        .setDisabled(off || state === 'offline' || state === 'stopping'),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${SERVER_BUTTON}:kopia`).setStyle(ButtonStyle.Secondary).setEmoji('💾').setLabel(t('Backup now'))
        .setDisabled(disabled || !status || !status.backupLimit),
      new ButtonBuilder().setCustomId(`${SERVER_BUTTON}:odswiez`).setStyle(ButtonStyle.Secondary).setEmoji('🔃').setLabel(t('Refresh')),
    ),
  ];
}

/** The status message: { embeds, components }. `notice` = a line on top (result of the last button). */
export async function buildServerView(guild, { notice = null, confirm = null } = {}) {
  const config = await getWhitelistConfig(guild.id);
  if (!config.apiKey) throw userError(t('Connect the server panel first with `/minecraft whitelista ustaw`.'));
  const panel = panelOf(config);
  let status = null;
  let problem = null;
  try {
    status = await serverStatus(panel);
  } catch (error) {
    problem = panelErrorText(error);
  }
  let backups = null;
  if (status?.backupLimit) backups = await listBackups(panel).catch(() => null);

  const lines = [];
  if (notice) lines.push(notice, '');
  if (confirm === 'stop') lines.push(t('⚠️ **Stop the server?** Everyone on it gets disconnected.'), '');
  if (confirm === 'restart') lines.push(t('⚠️ **Restart the server?** Everyone on it gets disconnected for a moment.'), '');
  if (problem) lines.push(`❌ ${problem}`);
  else lines.push(t`**${status.suspended ? t('⛔ Suspended by the hosting') : (STATES[status.state] ?? STATES.offline)()}**`);

  const fields = status ? [
    { name: t('CPU'), value: `${Math.round(status.cpu)}%${status.cpuLimit ? ` / ${status.cpuLimit}%` : ''}`, inline: true },
    { name: t('RAM'), value: `${size(status.memory)}${status.memoryLimit ? ` / ${size(status.memoryLimit)}` : ''}`, inline: true },
    { name: t('Disk'), value: `${size(status.disk)}${status.diskLimit ? ` / ${size(status.diskLimit)}` : ''}`, inline: true },
    { name: t('Running for'), value: status.state === 'running' && status.uptime ? span(status.uptime) : '-', inline: true },
    {
      name: t('💾 Backups'),
      value: status.backupLimit
        ? `${backups ? backups.filter((backup) => backup.ok || !backup.completedAt).length : '?'} / ${status.backupLimit}\n-# ${lastBackupLine(config)}`
        : t('not in your hosting plan'),
      inline: true,
    },
    { name: t('⏰ Automatic'), value: status.backupLimit ? scheduleText(Number(config.backupEveryHours) || 0) : '-', inline: true },
  ] : [];

  return {
    embeds: [createEmbed({
      title: `🖥️ ${status?.name ?? t('Minecraft server')}`,
      description: lines.join('\n'),
      fields,
      color: status?.state === 'running' ? 'success' : status ? 'warning' : 'error',
      footer: { text: t('Only administrators can use these buttons') },
    })],
    components: serverButtons(status, { confirm, disabled: Boolean(problem) && !status }),
  };
}

export async function runServer(interaction) {
  requirePermission(interaction, PermissionFlagsBits.Administrator);
  const view = await buildServerView(interaction.guild);
  return InteractionHelper.universalReply(interaction, { ...view, flags: MessageFlags.Ephemeral });
}
