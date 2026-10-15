// Buttons of /pozwij (commands/Economy/modules/lawsuit.js).
//   pozew:zmien:<plaintiffId>:<defendantId>:<amount>:<d50|d10|u10|u50>  change the amount
//   pozew:start:<plaintiffId>:<defendantId>:<amount>                    run the case
//   pozew:anuluj:<plaintiffId>                                          drop it
// Only the plaintiff can press them. The result is posted in the channel.

import { MessageFlags } from 'discord.js';
import { buildSuePreview, runLawsuit, stepAmount } from '../../../commands/Economy/modules/lawsuit.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
  name: 'pozew',

  async execute(interaction, client, args = []) {
    const [action, plaintiffId, defendantId, amountText, step] = args;
    const { guildId, user } = interaction;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      if (user.id !== plaintiffId) {
        await interaction.reply({ embeds: [infoEmbed(t('⚖️ Lawsuit'), t('This is not your case. Use `/pozwij` to sue someone.'))], flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'anuluj') {
        await interaction.update({ embeds: [infoEmbed(t('⚖️ Lawsuit'), t('Case dropped.'))], components: [] });
        return;
      }

      const defendant = await client.users.fetch(defendantId);
      const amount = Number(amountText) || 1;
      if (action === 'zmien') {
        await interaction.update(await buildSuePreview({ client, guildId, plaintiff: user, defendant, amount: stepAmount(amount, step) }));
        return;
      }
      if (action === 'start') {
        const outcome = await runLawsuit({ client, guildId, plaintiff: user, defendant, amount });
        if (outcome.preview) {
          await interaction.update(await buildSuePreview({ client, guildId, plaintiff: user, defendant, amount,
            notice: t`⚠️ ${defendant.username} has less money now - the amount and the chance changed.` }));
          return;
        }
        await interaction.update({ embeds: [infoEmbed(t('⚖️ Lawsuit'), t('The case is decided - see the result in the channel.'))], components: [] });
        await interaction.followUp(outcome.result);
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
