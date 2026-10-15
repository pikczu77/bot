// The economy messages fit Discord's limits in both languages (builders validate on toJSON).
import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockGuild, mockMember, mockUser } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { setEconomyData, getEconomyData } from '../src/utils/economy.js';
import { buildShopView, SHOP_CATEGORIES } from '../src/commands/Economy/modules/shop_browse.js';
import { buildUpgradesView, shopPrices } from '../src/commands/Economy/modules/upgrades_view.js';
import { localizeBody } from '../src/i18n/discordSink.js';

function check(view) {
  const body = localizeBody({ embeds: view.embeds, components: view.components });
  const json = JSON.parse(JSON.stringify({
    embeds: view.embeds.map((embed) => embed.toJSON()),
    components: view.components.map((row) => row.toJSON()),
  }));
  assert.ok(json.components.length <= 5);
  for (const row of json.components) {
    assert.ok(row.components.length <= 5);
    for (const part of row.components) {
      if (part.label) assert.ok(part.label.length <= 80, part.label);
      for (const option of part.options ?? []) {
        assert.ok(option.label.length <= 100 && (option.description ?? '').length <= 100, option.label);
      }
    }
  }
  for (const embed of json.embeds) {
    assert.ok((embed.description ?? '').length <= 4096);
    assert.ok((embed.fields ?? []).length <= 25);
    for (const field of embed.fields ?? []) assert.ok(field.value.length <= 1024 && field.name.length <= 256, field.name);
  }
  return body;
}

test('shop and upgrade views fit Discord limits in Polish and English', async () => {
  const { db } = await initializeDatabase();
  const client = { db, guilds: { cache: new Collection() } };
  const guild = mockGuild(client, 'Widoki');
  const member = mockMember(guild, mockUser('Ogladacz'));
  await setEconomyData(client, guild.id, member.id, {
    ...(await getEconomyData(client, guild.id, member.id)),
    wallet: 5_000_000, bank: 10, upgrades: { discount: 3, luck: 4 }, inventory: { fishing_rod: 1, golden_rod: 1, laptop: 1, steel_pickaxe: 1, dynamite: 2 },
  });
  const userData = await getEconomyData(client, guild.id, member.id);

  for (const locale of ['pl', 'en']) {
    await runWithLocale(locale, async () => {
      for (const category of SHOP_CATEGORIES) {
        check(await buildShopView({ client, guild, ownerId: member.id, categoryId: category.id }));
      }
      const prices = await shopPrices(guild);
      for (const folder of ['skills', 'items']) {
        const view = buildUpgradesView({ guildId: guild.id, userData, user: member.user, ownerId: member.id, folder, prices, notice: 'x' });
        check(view);
        const ids = view.components.flatMap((row) => row.toJSON().components.map((part) => part.custom_id));
        assert.equal(new Set(ids).size, ids.length);
      }
    });
  }
});
