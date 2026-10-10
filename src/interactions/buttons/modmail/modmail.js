import { MessageFlags } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { userError } from '../../../utils/featureKit.js';
import { ErrorTypes } from '../../../utils/errorHandler.js';
import {
  closeThread,
  getModmailConfig,
  isModmailStaff,
  openThread,
  relayToStaff,
} from '../../../services/modmailService.js';
import { pendingFirstMessages } from '../../../events/modmailMessages.js';
import { getGuildLocale } from '../../../services/languageService.js';
import { runWithLocale, switchLocale, t } from '../../../i18n/index.js';

const openButton = {
  name: 'modmail_open',
  async execute(interaction, client, [guildId]) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw userError(t('That server is no longer available.'));

    await interaction.deferUpdate();
    // From here on the conversation runs in that server's language.
    switchLocale(await getGuildLocale(client, guild.id));

    const thread = await openThread(client, guild, interaction.user);
    const pending = pendingFirstMessages.get(interaction.user.id);
    pendingFirstMessages.delete(interaction.user.id);
    if (pending?.message) {
      await relayToStaff(client, thread, pending.message);
    }

    const config = await getModmailConfig(guild.id);
    await interaction.editReply({
      embeds: [createEmbed({
        title: t('✅ Message sent'),
        description: config.greeting
          || t`The staff of **${guild.name}** got your message. Write here to add more — they will answer in this chat.`,
        color: 'success',
        footer: guild.name,
      })],
      components: [],
    });
  },
};

const cancelButton = {
  name: 'modmail_cancel',
  async execute(interaction) {
    pendingFirstMessages.delete(interaction.user.id);
    await interaction.update({
      embeds: [createEmbed({ description: t('Cancelled. Nothing was sent.'), color: 'secondary', footer: false })],
      components: [],
    });
  },
};

const closeButton = {
  name: 'modmail_close',
  async execute(interaction, client) {
    const config = await getModmailConfig(interaction.guildId);
    if (!isModmailStaff(interaction.member, config)) {
      throw userError(t('Only staff can close this conversation.'), ErrorTypes.PERMISSION);
    }
    await interaction.reply({ embeds: [successEmbed(t('Closing the conversation…'))], flags: MessageFlags.Ephemeral });
    const locale = await getGuildLocale(client, interaction.guildId);
    await runWithLocale(locale, () => closeThread(client, interaction.guild, interaction.channelId, interaction.member));
  },
};

export default [openButton, cancelButton, closeButton];
