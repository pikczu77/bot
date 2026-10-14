// Buttons of the /ulepszenia message and the "Permanent upgrades" button of the shop.
//   ulepszenia:pokaz:<ownerId>             show the clicker's upgrades (private reply)
//   ulepszenia:kup:<ownerId>:<upgradeId>   buy the next level
// Someone pressing another member's button gets their own list as a private reply.

import { MessageFlags } from 'discord.js';
import { buildUpgradesView } from '../../../commands/Economy/modules/upgrades_view.js';
import { buyUpgrade } from '../../../services/economyUpgrades.js';
import { getEconomyAccessDenial, getEconomySettings, money } from '../../../services/economySettings.js';
import { getEconomyData } from '../../../utils/economy.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t, tr } from '../../../i18n/index.js';

export default {
    name: 'ulepszenia',

    async execute(interaction, client, args = []) {
        const [action, ownerId, upgradeId] = args;
        const { guildId, user } = interaction;

        try {
            const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
            if (denial) {
                await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
                return;
            }
            await getEconomySettings(guildId);

            if (action !== 'kup' || user.id !== ownerId) {
                const userData = await getEconomyData(client, guildId, user.id);
                const view = buildUpgradesView({ guildId, userData, user, ownerId: user.id });
                await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
                return;
            }

            const result = await buyUpgrade(client, guildId, user.id, upgradeId);
            let notice;
            if (result.ok) {
                notice = t`✅ **${tr(result.upgrade.name)}** is now level **${result.level}** (−${money(guildId, result.price)}).`;
            } else if (result.reason === 'max') {
                notice = t`**${tr(result.upgrade.name)}** is already at the highest level.`;
            } else if (result.reason === 'money') {
                notice = t`❌ The next level of **${tr(result.upgrade.name)}** costs **${money(guildId, result.price)}** - you do not have that much (cash and bank).`;
            } else {
                notice = t('❌ This upgrade does not exist any more.');
            }

            const userData = result.userData ?? await getEconomyData(client, guildId, user.id);
            await interaction.update(buildUpgradesView({ guildId, userData, user, ownerId, notice }));
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
        }
    },
};
