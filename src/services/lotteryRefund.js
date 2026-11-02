// lotteryRefund.js — the weekly lottery was removed on 2026-11-02 (owner: "tygodniowe loterie i top cluby tygodnia mozna wyjebac").
// Tickets bought for a round that is never drawn go back to their buyers once, then the lottery's store is deleted, so this
// does nothing on the next start. Delete this file when no server can still have the store `guild:<id>:lottery`.

import { getFromDb, deleteFromDb } from '../utils/database/wrapper.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { withEconomyLock } from './economyUpgrades.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TICKET_PRICE = 500;

/** Pays back the tickets of the open round on every server. Returns how many members got money back. */
export async function refundLotteryOnce(client) {
  let paid = 0;
  for (const guild of client.guilds.cache.values()) {
    const key = `guild:${guild.id}:lottery`;
    const lottery = await getFromDb(key, null);
    if (!lottery) continue;
    const price = Number(lottery.ticketPrice) || DEFAULT_TICKET_PRICE;
    for (const [userId, count] of Object.entries(lottery.round?.tickets ?? {})) {
      const amount = (Number(count) || 0) * price;
      if (amount <= 0) continue;
      await withEconomyLock(guild.id, userId, async () => {
        const userData = await getEconomyData(client, guild.id, userId, { joint: false });
        userData.wallet = (Number(userData.wallet) || 0) + amount;
        await setEconomyData(client, guild.id, userId, userData);
      });
      paid += 1;
    }
    await deleteFromDb(key);
    logger.info(`Lottery removed in guild ${guild.id}: tickets paid back to ${Object.keys(lottery.round?.tickets ?? {}).length} members`);
  }
  return paid;
}
