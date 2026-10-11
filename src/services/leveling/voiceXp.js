// voiceXp.js — XP for time spent in voice channels. Runs once a minute (features.js).

import { logger } from '../../utils/logger.js';
import { runWithLocale } from '../../i18n/index.js';
import { getGuildLocale } from '../languageService.js';
import { applyXpMultipliers, canEarnXp, getLevelingConfig } from './leveling.js';
import { addXp } from './xpSystem.js';

const isMuted = (state) => state.selfMute || state.selfDeaf || state.serverMute || state.serverDeaf;

/** Members of one guild who earn voice XP right now, with the channel they sit in. */
export function findVoiceEarners(guild, config) {
  const humansByChannel = new Map();
  for (const state of guild.voiceStates.cache.values()) {
    if (!state.channelId || !state.member || state.member.user.bot) continue;
    if (state.channelId === guild.afkChannelId) continue;
    const list = humansByChannel.get(state.channelId) ?? [];
    list.push(state);
    humansByChannel.set(state.channelId, list);
  }

  const earners = [];
  for (const states of humansByChannel.values()) {
    if (!config.voiceCountAlone && states.length < 2) continue;
    for (const state of states) {
      if (!config.voiceCountMuted && isMuted(state)) continue;
      if (!canEarnXp(config, state.member, state.channel)) continue;
      earners.push({ member: state.member, channel: state.channel });
    }
  }
  return earners;
}

export async function awardVoiceXp(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const config = await getLevelingConfig(client, guild.id);
      const perMinute = Math.floor(Number(config.voiceXpPerMinute) || 0);
      if (!config.enabled || perMinute <= 0) continue;

      const earners = findVoiceEarners(guild, config);
      if (earners.length === 0) continue;

      const locale = await getGuildLocale(client, guild.id);
      await runWithLocale(locale, async () => {
        for (const { member, channel } of earners) {
          const xp = applyXpMultipliers(config, perMinute, { member, channel });
          await addXp(client, guild, member, xp, { touchCooldown: false });
        }
      });
    } catch (error) {
      logger.warn(`Voice XP failed for guild ${guild.id}: ${error.message}`);
    }
  }
}
