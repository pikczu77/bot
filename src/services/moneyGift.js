// moneyGift.js — one-time money for every member, given at start (owner's requests).
//
// 2026-11-10: the old host expired and took every balance with it; owner: "daj kazdemu po 300k hajsu".
// Every human member of every server the bot is on gets the amount in cash once. A marker per gift in
// the data file keeps a restart from paying twice. Members who join later get nothing.
// A new gift = a new entry with a new id.

import { getFromDb, setInDb } from '../utils/database/wrapper.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { withEconomyLock } from './economyUpgrades.js';
import { createTraceId, logger, runWithTraceContext } from '../utils/logger.js';

export const GIFTS = [{ id: '2026-11-10-300k', amount: 300_000, field: 'wallet' }];

/** Pays one gift on one server. Returns how many members got it. */
export async function payGift(client, guild, gift) {
  const members = await guild.members.fetch();
  let paid = 0;
  for (const member of members.values()) {
    if (member.user?.bot) continue;
    await withEconomyLock(guild.id, member.id, async () => {
      const userData = await getEconomyData(client, guild.id, member.id, { joint: false });
      userData[gift.field] = (Number(userData[gift.field]) || 0) + gift.amount;
      await setEconomyData(client, guild.id, member.id, userData);
    });
    paid += 1;
  }
  return paid;
}

/** At start: every gift not paid yet, on every server. */
export async function payGiftsOnce(client) {
  for (const gift of GIFTS) {
    const marker = `bot:gift:${gift.id}`;
    const done = (await getFromDb(marker, null)) || { guilds: {} };
    let changed = false;
    for (const guild of client.guilds.cache.values()) {
      if (done.guilds[guild.id] !== undefined) continue;
      try {
        const paid = await runWithTraceContext({ traceId: createTraceId('job'), command: 'job:gift' }, () => payGift(client, guild, gift));
        done.guilds[guild.id] = paid;
        changed = true;
        logger.info(`Gift ${gift.id}: ${gift.amount} to ${paid} members in guild ${guild.id}`);
      } catch (error) {
        logger.warn(`Gift ${gift.id} failed in guild ${guild.id}: ${error.message}`);
      }
      // Saved after each server, so a crash half-way never pays a finished server twice.
      if (changed) await setInDb(marker, { ...done, at: Date.now() });
    }
  }
}
