// Job offer buttons of /work.
//   praca:wybierz:<ownerId>:<jobId>   take that job (and work the first shift)
// Only the member the offers were made for can take one; others get a private hint.

import { MessageFlags } from 'discord.js';
import { chooseJob } from '../../../commands/Economy/modules/work_shift.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { infoEmbed, warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
    name: 'praca',

    async execute(interaction, client, args = []) {
        const [action, ownerId, jobId] = args;

        try {
            const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
            if (denial) {
                await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
                return;
            }
            if (action !== 'wybierz' || interaction.user.id !== ownerId) {
                await interaction.reply({
                    embeds: [infoEmbed(t('💼 Job offers'), t('These offers are for someone else. Use `/work` to get your own.'))],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const view = await chooseJob({ client, guildId: interaction.guildId, user: interaction.user, jobId });
            if (!view) {
                await interaction.reply({
                    embeds: [infoEmbed(t('💼 Job offers'), t('This offer is no longer valid. Use `/work` again.'))],
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
