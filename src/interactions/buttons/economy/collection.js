// Buttons of /paczka and /index (commands/Economy/modules/collection_view.js).
//   paczka:otworz:<ownerId>:<packId>            buy and open a pack (the message shows it)
//   paczka:sprzedaj:<ownerId>:<card.card_g...>  sell the cards that came out of that pack
//   index:pokaz:<viewerId>:<userId>:<karty|ryby> switch the tab of an index
//   index:duplikaty:<ownerId>                   sell every extra copy, keep one of each
// Someone pressing another member's button gets their own view as a private reply.

import { MessageFlags } from 'discord.js';
import { buildIndexView, buildPackShop, buildPackView, decodeKey, duplicateKeys, openPack, sellCards } from '../../../commands/Economy/modules/collection_view.js';
import { getEconomyAccessDenial, getEconomySettings, money } from '../../../services/economySettings.js';
import { getEconomyData } from '../../../utils/economy.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { warningEmbed } from '../../../utils/embeds.js';
import { t } from '../../../i18n/index.js';

async function denied(interaction) {
  const denial = await getEconomyAccessDenial(interaction, { category: 'Economy' });
  if (!denial) return false;
  await interaction.reply({ embeds: [warningEmbed(t('Economy'), denial)], flags: MessageFlags.Ephemeral });
  return true;
}

const paczka = {
  name: 'paczka',

  async execute(interaction, client, args = []) {
    const [action, ownerId, target] = args;
    const { guildId, user } = interaction;
    try {
      if (await denied(interaction)) return;
      await getEconomySettings(guildId);

      if (user.id !== ownerId) {
        const userData = await getEconomyData(client, guildId, user.id);
        await interaction.reply({ ...buildPackShop({ guildId, ownerId: user.id, userData }), flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'otworz') {
        const result = await openPack({ client, guildId, userId: user.id, packId: target });
        await interaction.update(buildPackView({ guildId, ownerId: user.id, ...result }));
        return;
      }

      if (action === 'sprzedaj') {
        const keys = String(target || '').split('.').map(decodeKey).filter(Boolean);
        const { total, count, userData } = await sellCards({ client, guildId, userId: user.id, keys });
        const view = buildIndexView({ guildId, user, viewerId: user.id, userData,
          notice: count ? t`💰 Sold **${count}** {0|card|cards} for **${money(guildId, total)}**.` : t('These cards are not in your index any more.') });
        await interaction.update(view);
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};

const index = {
  name: 'index',

  async execute(interaction, client, args = []) {
    const [action, viewerId, targetId, tab] = args;
    const { guildId, user } = interaction;
    try {
      if (await denied(interaction)) return;
      await getEconomySettings(guildId);

      if (action === 'pokaz') {
        const target = targetId === user.id ? user : (await client.users.fetch(targetId).catch(() => null)) ?? { id: targetId, username: '?' };
        const userData = await getEconomyData(client, guildId, target.id);
        const view = buildIndexView({ guildId, user: target, viewerId: user.id, userData, tab });
        if (user.id === viewerId) await interaction.update(view);
        else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'duplikaty') {
        if (user.id !== viewerId) {
          const userData = await getEconomyData(client, guildId, user.id);
          await interaction.reply({ ...buildIndexView({ guildId, user, viewerId: user.id, userData }), flags: MessageFlags.Ephemeral });
          return;
        }
        const own = await getEconomyData(client, guildId, user.id);
        const { total, count, userData } = await sellCards({ client, guildId, userId: user.id, keys: duplicateKeys(own.cards) });
        await interaction.update(buildIndexView({ guildId, user, viewerId: user.id, userData,
          notice: count ? t`♻️ Sold **${count}** {0|duplicate|duplicates} for **${money(guildId, total)}**. One of each card stays.` : t('No duplicates to sell.') }));
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};

export default [paczka, index];
