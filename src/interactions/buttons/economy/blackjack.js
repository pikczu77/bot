// Buttons of /blackjack.
//   bj:dobierz:<ownerId>   draw a card
//   bj:stoj:<ownerId>      stand - the dealer plays
//   bj:podwoj:<ownerId>    double the bet, one more card, stand
// Only the player can press them.

import { MessageFlags } from 'discord.js';
import { playBlackjack } from '../../../commands/Economy/modules/blackjack_game.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
    name: 'bj',

    async execute(interaction, client, args = []) {
        const [action, ownerId] = args;

        try {
            const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
            if (denial) {
                await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
                return;
            }
            if (interaction.user.id !== ownerId) {
                await interaction.reply({
                    embeds: [infoEmbed(t('🃏 Blackjack'), t('This is someone else\'s game. Start your own with `/blackjack`.'))],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const view = await playBlackjack({ client, guildId: interaction.guildId, user: interaction.user, action });
            if (!view) {
                await interaction.update({ components: [] });
                await interaction.followUp({
                    embeds: [infoEmbed(t('🃏 Blackjack'), t('This game is over. Start a new one with `/blackjack`.'))],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.update(view);
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
        }
    },
};
