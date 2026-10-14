// Topic menu of the economy guide (/economy poradnik).
//   poradnik:pokaz  the menu on the channel message: opens the tutorial as a private reply
//   poradnik:zmien  the menu inside a private tutorial: switches the topic in place
// Anyone may use it; the tutorials are information only.

import { MessageFlags } from 'discord.js';
import { buildTopicView, guideMenu } from '../../../commands/Economy/modules/economy_guide.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
    name: 'poradnik',

    async execute(interaction, client, args = []) {
        const [action] = args;
        try {
            const view = await buildTopicView(client, interaction.guild, interaction.values?.[0]);
            if (action === 'zmien') {
                await interaction.update(view);
                return;
            }
            // Answering with an update resets the channel menu, so it does not keep showing
            // this member's pick; the tutorial itself comes as a private follow-up.
            await interaction.update({ components: [guideMenu()] });
            await interaction.followUp({ ...view, flags: MessageFlags.Ephemeral });
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
        }
    },
};
