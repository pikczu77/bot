// Buttons of the /ulepszenia message and of the shop.
//   ulepszenia:pokaz:<ownerId>[:<folder>]     show the clicker's upgrades (private reply)
//   ulepszenia:folder:<ownerId>:<folder>      switch between "skills" and "items"
//   ulepszenia:kup:<ownerId>:<upgradeId>      buy the next level of an upgrade
//   ulepszenia:przedmiot:<ownerId>:<chainId>  buy the next item tier (rod, pickaxe, ...)
//   ulepszenia:event:<ownerId>:<upgradeId>    buy the next level of an upgrade of the running holiday event
// Someone pressing another member's button gets their own list as a private reply.

import { MessageFlags } from 'discord.js';
import { FOLDERS, buildUpgradesView, shopPrices } from '../../../commands/Economy/modules/upgrades_view.js';
import { purchaseItem, itemLabel } from '../../../commands/Economy/modules/buy.js';
import { buyUpgrade } from '../../../services/economyUpgrades.js';
import { getEconomyAccessDenial, getEconomySettings, money } from '../../../services/economySettings.js';
import { nextInChain } from '../../../config/shop/items.js';
import { getEconomyData } from '../../../utils/economy.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { buySeasonUpgrade, openSeason } from '../../../services/seasonalEvents.js';
import { userError } from '../../../utils/featureKit.js';
import { t, tr } from '../../../i18n/index.js';

async function eventNotice(client, guildId, userId, season, upgradeId) {
  if (!season) return t('❌ The event shop is closed.');
  try {
    const { upgrade, level, price } = await buySeasonUpgrade({ event: season.event, client, guildId, userId, upgradeId, userError });
    return t`✅ **${tr(upgrade.name)}** is now level **${level}** (−${price} ${season.event.currency}).`;
  } catch (error) {
    if (!error?.userMessage) throw error;
    return `❌ ${error.userMessage}`;
  }
}

async function upgradeNotice(client, guildId, userId, upgradeId) {
  const result = await buyUpgrade(client, guildId, userId, upgradeId);
  if (result.ok) return t`✅ **${tr(result.upgrade.name)}** is now level **${result.level}** (−${money(guildId, result.price)}).`;
  if (result.reason === 'max') return t`**${tr(result.upgrade.name)}** is already at the highest level.`;
  if (result.reason === 'money') return t`❌ The next level of **${tr(result.upgrade.name)}** costs **${money(guildId, result.price)}** - you do not have that much (cash and bank).`;
  return t('❌ This upgrade does not exist any more.');
}

async function itemNotice(client, interaction, chainId) {
  const userData = await getEconomyData(client, interaction.guildId, interaction.user.id);
  const next = nextInChain(userData, chainId);
  if (!next) return t('✅ You already have the best one.');
  try {
    await purchaseItem({ client, guild: interaction.guild, member: interaction.member, itemId: next.id });
    return t`✅ You bought **${itemLabel(next)}**.`;
  } catch (error) {
    if (!error?.userMessage) throw error;
    return `❌ ${error.userMessage}`;
  }
}

export default {
  name: 'ulepszenia',

  async execute(interaction, client, args = []) {
    const [action, ownerId, target] = args;
    const { guildId, user } = interaction;

    try {
      const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
      if (denial) {
        await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
        return;
      }
      await getEconomySettings(guildId);
      const prices = await shopPrices(interaction.guild);
      const season = await openSeason(guildId);
      const own = user.id === ownerId;

      let folder = 'skills';
      if (action === 'folder' || action === 'pokaz') folder = FOLDERS.includes(target) ? target : 'skills';
      if (action === 'przedmiot') folder = 'items';
      if (action === 'event') folder = 'event';

      if (!own || action === 'pokaz') {
        const userData = await getEconomyData(client, guildId, user.id);
        const view = buildUpgradesView({ guildId, userData, user, ownerId: user.id, folder, prices, season });
        await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
        return;
      }

      let notice = '';
      if (action === 'kup') notice = await upgradeNotice(client, guildId, user.id, target);
      if (action === 'przedmiot') notice = await itemNotice(client, interaction, target);
      if (action === 'event') notice = await eventNotice(client, guildId, user.id, season, target);

      const userData = await getEconomyData(client, guildId, user.id);
      await interaction.update(buildUpgradesView({ guildId, userData, user, ownerId, folder, prices, notice, season }));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
