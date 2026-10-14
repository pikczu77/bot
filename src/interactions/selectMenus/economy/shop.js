// Menus of the /sklep przegladaj message.
//   sklep:kat:<ownerId>               switch the category
//   sklep:kup:<ownerId>:<categoryId>  buy the picked item
// Anyone may use them: a purchase is always made by (and charged to) the person who
// clicked. Only the owner's clicks change the message itself; others get their own
// view as a private reply.

import { MessageFlags } from 'discord.js';
import { buildShopView } from '../../../commands/Economy/modules/shop_browse.js';
import { purchaseItem } from '../../../commands/Economy/modules/buy.js';
import { getEconomyAccessDenial } from '../../../services/economySettings.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

export default {
    name: 'sklep',

    async execute(interaction, client, args = []) {
        const [action, ownerId, categoryId] = args;
        const isOwner = interaction.user.id === ownerId;

        try {
            const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
            if (denial) {
                await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
                return;
            }

            const picked = interaction.values?.[0];

            if (action === 'kat') {
                const view = await buildShopView({ client, guild: interaction.guild, ownerId: interaction.user.id, categoryId: picked });
                if (isOwner) await interaction.update(view);
                else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
                return;
            }

            if (action === 'kup') {
                const receipt = await purchaseItem({ client, guild: interaction.guild, member: interaction.member, itemId: picked });
                if (isOwner) {
                    await interaction.update(await buildShopView({ client, guild: interaction.guild, ownerId, categoryId }));
                    await interaction.followUp({ embeds: [receipt], flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ embeds: [receipt], flags: MessageFlags.Ephemeral });
                }
            }
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'select_menu', customId: interaction.customId });
        }
    },
};
