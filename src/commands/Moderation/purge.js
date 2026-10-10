import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { t } from '../../i18n/index.js';
export default {
    data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete a specific amount of messages")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages (1-100)")
        .setRequired(true),
    )
    .addUserOption((option) =>
      option.setName("user").setDescription("Only delete messages from this member"),
    )
    .addBooleanOption((option) =>
      option.setName("bots").setDescription("Only delete messages sent by bots"),
    )
    .addStringOption((option) =>
      option.setName("contains").setDescription("Only delete messages containing this text").setMaxLength(100),
    )
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  category: "moderation",
  abuseProtection: { maxAttempts: 5, windowMs: 60_000 },

  async execute(interaction, config, client) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction, {
      flags: MessageFlags.Ephemeral,
    });
    if (!deferSuccess) {
      logger.warn(`Purge interaction defer failed`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'purge'
      });
      return;
    }

    const amount = interaction.options.getInteger("amount");
    const channel = interaction.channel;

    if (amount < 1 || amount > 100)
      return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('Please specify a number between 1 and 100.') });

    try {
      const onlyUser = interaction.options.getUser("user");
      const onlyBots = interaction.options.getBoolean("bots") === true;
      const contains = interaction.options.getString("contains")?.toLowerCase() ?? null;
      const filtered = Boolean(onlyUser || onlyBots || contains);

      // With a filter, look through the last 100 messages and delete up to `amount` matches.
      const fetched = await channel.messages.fetch({ limit: filtered ? 100 : amount });
      const targets = filtered
        ? [...fetched.values()]
            .filter((message) => !onlyUser || message.author?.id === onlyUser.id)
            .filter((message) => !onlyBots || message.author?.bot)
            .filter((message) => !contains || message.content?.toLowerCase().includes(contains))
            .slice(0, amount)
        : fetched;
      const deleted = await channel.bulkDelete(targets, true);
      const deletedCount = deleted.size;

      await logEvent({
        client,
        guild: interaction.guild,
        event: {
          action: "Messages Purged",
          target: t`${channel} (${deletedCount} messages)`,
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          reason: t`Deleted ${deletedCount} messages`,
          metadata: {
            channelId: channel.id,
            messageCount: deletedCount,
            requestedAmount: amount,
            moderatorId: interaction.user.id
          }
        }
      });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          successEmbed(
            t("Messages Purged"),
            t`Deleted ${deletedCount} messages in ${channel}.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });

      setTimeout(() => {
        interaction.deleteReply().catch(err => 
          logger.debug('Failed to auto-delete purge response:', err)
        );
      }, 3000);
    } catch (error) {
      logger.error('Purge command error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: t('An unexpected error occurred during message deletion. Note: Messages older than 14 days cannot be bulk deleted.') });
    }
  }
};