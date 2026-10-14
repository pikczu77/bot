import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
  getCountingGameConfig,
  activateCountingGame,
  disableCountingGame,
  resetCountingGame,
  buildCountingLeaderboard,
  getCountingSystemChoices,
  getCountingSystemLabel,
  getExpectedCountValue,
} from '../../services/countingGameService.js';
import { logger } from '../../utils/logger.js';

import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { t } from '../../i18n/index.js';
export default {
  data: new SlashCommandBuilder()
    .setName('liczenie')
    .setDescription('Manage the server counting game')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setDescription('Start a counting game in a text channel')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('The channel where counting will take place')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((option) =>
          option
            .setName('system')
            .setDescription('The counting system to use')
            .setRequired(true)
            .addChoices(...getCountingSystemChoices()),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('wylacz').setDescription('Disable the counting game for this server'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('View current counting game status'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Reset the current counting sequence')
        .addIntegerOption((option) =>
          option
            .setName('start')
            .setDescription('The number to start at after reset')
            .setMinValue(1),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('top').setDescription('Show the counting game leaderboard'),
    ),
  category: 'Fun',

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) {
        logger.warn('Count command defer failed', { userId: interaction.user.id, guildId: interaction.guildId });
        return;
      }

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: t('You need the **Manage Server** permission to use this command.') });
      }

      const guildId = interaction.guildId;
      const subcommand = interaction.options.getSubcommand();
      const config = await getCountingGameConfig(interaction.client, guildId);

      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const system = interaction.options.getString('system');
        if (!channel || channel.type !== ChannelType.GuildText) {
          return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('Please choose a text channel for the counting game.') });
        }

        if (config.enabled && config.channelId && config.channelId !== channel.id) {
          return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: t`This server already has an active counting channel configured: <#${config.channelId}>. Disable the current counting game first, or use that existing channel.` });
        }

        await activateCountingGame(interaction.client, guildId, channel.id, system);
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              t('Counting Game Enabled'),
              t`The counting game is now active in ${channel} using the **${getCountingSystemLabel(system)}** system. Players must count up from **1** and may not post two numbers in a row.`,
            ),
          ],
        });
      }

      if (subcommand === 'wylacz') {
        if (!config.enabled) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [infoEmbed(t('Counting Game Disabled'), t('The counting game is already disabled for this server.'))],
          });
        }

        await disableCountingGame(interaction.client, guildId);
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [successEmbed(t('Counting Game Disabled'), t('The counting game has been disabled.'))],
        });
      }

      if (subcommand === 'status') {
        const fields = [
          { name: t('Enabled'), value: config.enabled ? t('Yes') : t('No'), inline: true },
          { name: t('Channel'), value: config.channelId ? `<#${config.channelId}>` : t('Not configured'), inline: true },
          { name: t('System'), value: getCountingSystemLabel(config.system), inline: true },
          { name: t('Next count'), value: getExpectedCountValue(config), inline: true },
          { name: t('Current streak'), value: `${config.currentStreak}`, inline: true },
          { name: t('Best streak'), value: `${config.bestStreak || 0}`, inline: true },
          { name: t('Last counter'), value: config.lastUserId ? `<@${config.lastUserId}>` : t('None'), inline: true },
        ];

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: t('Counting Game Status'),
              description: t('Overview of the currently configured counting game.'),
              fields,
              color: 'primary',
            }),
          ],
        });
      }

      if (subcommand === 'reset') {
        if (!config.enabled) {
          return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: t('Enable the counting game first with `/liczenie setup`.') });
        }

        const startNumber = interaction.options.getInteger('start') || 1;
        await resetCountingGame(interaction.client, guildId, startNumber);

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              t('Counting Game Reset'),
              t`The counting sequence has been reset. Start again with **${startNumber}** in <#${config.channelId}>.`,
            ),
          ],
        });
      }

      if (subcommand === 'top') {
        const leaderboard = buildCountingLeaderboard(config, interaction.guild);

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: t('Counting Game Leaderboard'),
              description: leaderboard.length > 0 ? leaderboard.join('\n') : t('No counts have been recorded yet.'),
              color: 'primary',
            }),
          ],
        });
      }

      return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('Please choose a valid counting game action.') });
    } catch (error) {
      logger.error('Count command error:', error);
      return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: t('Something went wrong while managing the counting game.') });
    }
  },
};
