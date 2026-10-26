// happyHourState.js — which servers have the happy hour running right now (services/chatEngagement.js sets it
// every minute). Kept apart so the leveling code can read it without importing the whole chat module.

const active = new Map(); // guildId -> XP percent while the happy hour runs

export const setHappyHour = (guildId, percent) => (percent > 100 ? active.set(guildId, percent) : active.delete(guildId));
/** XP factor of a message on `guildId` (2 during a 200% happy hour, 1 otherwise). */
export const happyHourFactor = (guildId) => (active.get(guildId) ?? 100) / 100;
