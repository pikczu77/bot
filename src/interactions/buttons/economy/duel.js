// Buttons of /pojedynek (commands/Economy/modules/duel.js): accept / decline, then each player's move.
// A timer per duel ends the picking after PICK_MS and edits the message.

import { MessageFlags } from 'discord.js';
import { PICK_MS, acceptDuel, closeDuel, getDuel, pickMove, timeoutDuel } from '../../../commands/Economy/modules/duel.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

/** Tests replace it to run the timer at once. */
export const duelTimers = { delayMs: PICK_MS + 500 };

function scheduleTimeout(client, duel, message) {
  clearTimeout(duel.timer);
  duel.timer = setTimeout(async () => {
    try {
      const update = await timeoutDuel({ client, duel });
      if (update) await message.edit(update);
    } catch (error) {
      logger.warn(`Duel timeout failed: ${error.message}`);
    }
  }, duelTimers.delayMs);
  duel.timer.unref?.();
}

const privately = (interaction, text) => interaction.reply({ embeds: [infoEmbed(t('⚔️ Duel'), text)], flags: MessageFlags.Ephemeral });

export default {
  name: 'pojedynek',

  async execute(interaction, client, args = []) {
    const [action, id, move] = args;
    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      const duel = getDuel(id);
      if (!duel) {
        await interaction.update({ components: [] }).catch(() => {});
        await interaction.followUp({ embeds: [infoEmbed(t('⚔️ Duel'), t('This duel is over. Start a new one with `/pojedynek`.'))], flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      const userId = interaction.user.id;

      if (action === 'nie') {
        if (![duel.a, duel.b].includes(userId) || duel.state !== 'invite') return privately(interaction, t('This challenge is not for you.'));
        await interaction.update(closeDuel(duel, userId === duel.a));
        return;
      }
      if (action === 'ok') {
        if (userId !== duel.b || duel.state !== 'invite') return privately(interaction, t('Only the challenged member can accept.'));
        await interaction.update(await acceptDuel({ client, duel }));
        if (duel.state === 'pick') scheduleTimeout(client, duel, interaction.message);
        return;
      }
      if (action === 'pick') {
        const result = await pickMove({ client, duel, userId, move });
        if (result.update) {
          await interaction.update(result.update);
          if (duel.state === 'pick' && Object.keys(duel.picks).length === 0) scheduleTimeout(client, duel, interaction.message);
          else clearTimeout(duel.timer);
          return;
        }
        await privately(interaction, result.reply);
        if (result.refresh) await interaction.message?.edit(result.refresh).catch(() => {});
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
