// economyJail.js — jail after a failed /crime.
//
// `jailedUntil` in a member's economy data. While it is in the future the member cannot
// earn or play: /work, /mine, /fish, /beg, /crime, /slut, /rob and the casino games all
// call assertNotJailed. /daily, the bank, /pay, the shop and the upgrades still work.
// The Stamina upgrade does not shorten jail.

import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { formatDuration } from '../utils/embeds.js';
import { t } from '../i18n/index.js';

/** Milliseconds of jail left, 0 when the member is free. */
export const jailTimeLeft = (userData, now = Date.now()) => Math.max(0, (Number(userData?.jailedUntil) || 0) - now);

/** Throw a user error while the member is in jail. */
export function assertNotJailed(userData, now = Date.now()) {
  const left = jailTimeLeft(userData, now);
  if (left <= 0) return;
  throw createError(
    "User is in jail",
    ErrorTypes.RATE_LIMIT,
    t`🚔 You're in jail for **${formatDuration(left)}** more. In jail you cannot work, earn money or play in the casino.`,
    { jailTimeRemaining: left, cooldownType: 'jail', expected: true },
  );
}
