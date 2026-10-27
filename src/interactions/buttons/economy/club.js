// Invite buttons of /klub zapros (commands/Economy/klub.js, services/clubs.js).
//   klub:tak:<clubId>:<userId>  only the invited member: join
//   klub:nie:<clubId>:<userId>  only the invited member: decline

import { MessageFlags } from 'discord.js';
import { answerInvite, clubLabel } from '../../../services/clubs.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { progressEmbeds } from '../../../services/progress.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { createEmbed, infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { userError } from '../../../utils/featureKit.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'klub',

  async execute(interaction, client, args = []) {
    const [action, clubId, userId] = args;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      if (interaction.user.id !== userId) {
        await interaction.reply({ embeds: [infoEmbed(t('📨 Club'), t('This invite is not for you.'))], flags: MessageFlags.Ephemeral });
        return;
      }
      const { club, joined, progress } = await answerInvite({
        client, guildId: interaction.guildId, clubId, userId, accept: action === 'tak', userError,
      });
      await interaction.update({
        content: '',
        embeds: [
          createEmbed({
            title: joined ? t`✅ Welcome to ${clubLabel(club)}` : t`📨 Invite to ${clubLabel(club)}`,
            description: joined
              ? t`<@${userId}> joined the club. See it with \`/klub info\`.`
              : t`<@${userId}> said no thanks.`,
            color: joined ? '#30D158' : '#8E8E93',
            footer: false,
          }),
          ...(joined ? progressEmbeds(progress, interaction.guildId) : []),
        ],
        components: [],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
