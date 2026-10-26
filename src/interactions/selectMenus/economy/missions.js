// Swap menu under /misje (custom id misje:zmien:<ownerId>): one free swap a day and one a week.
// Only the owner of the missions can use it.

import { MessageFlags } from 'discord.js';
import { swapMission } from '../../../commands/Economy/modules/progress_view.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { t } from '../../../i18n/index.js';

export default {
    name: 'misje',

    async execute(interaction, client, args = []) {
        const [action, ownerId] = args;
        try {
            if (action !== 'zmien') return;
            if (interaction.user.id !== ownerId) {
                await interaction.reply({ content: t('These are not your missions. Use `/misje`.'), flags: MessageFlags.Ephemeral });
                return;
            }
            await interaction.update(await swapMission({ client, guildId: interaction.guildId, user: interaction.user, value: interaction.values?.[0] }));
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
        }
    },
};
