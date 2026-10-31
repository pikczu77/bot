// features.js — start-up hooks and scheduled jobs of the feature modules.

import cron from 'node-cron';
import { runSafeTask } from '../utils/errorHandler.js';
import { createTraceId, logger, runWithTraceContext } from '../utils/logger.js';
import { botConfig } from '../config/bot.js';
import { cacheAllInvites } from './inviteService.js';
import { checkYoutubeFeeds } from './notifications/youtube.js';
import { refreshMinecraftServers } from './minecraftService.js';
import { liftExpiredBans } from './moderation/tempbanService.js';
import { awardVoiceXp } from './leveling/voiceXp.js';
import { applyNightChannels } from './nightChannel.js';
import { runEconomyEvents } from './economyEvents.js';
import { runQuiz } from './quiz.js';
import { runLottery } from './lottery.js';
import { runChatEngagement } from './chatEngagement.js';
import { syncChatBridges } from './minecraftChat.js';
import { resetAllWarningsOnce } from './moderation/warningPunishments.js';
import { runBackups } from './minecraftServer.js';
import { pollMinecraftLive } from './minecraftLive.js';
import { runStockMarket } from './stockMarket.js';
import { runClubs } from './clubs.js';
import { runSeasonalEvents } from './seasonalEvents.js';
import { runDataBackups } from './dataBackup.js';
import { runReminders } from './reminders.js';
import { runEconomyStats } from './economyStats.js';

const JOBS = [
  { name: 'night_channel', schedule: '* * * * *', run: applyNightChannels },
  { name: 'youtube_check', schedule: '*/5 * * * *', run: checkYoutubeFeeds },
  { name: 'minecraft_status', schedule: '*/2 * * * *', run: refreshMinecraftServers },
  { name: 'tempban_expiry', schedule: '* * * * *', run: liftExpiredBans },
  { name: 'voice_xp', schedule: '* * * * *', run: awardVoiceXp },
  { name: 'economy_events', schedule: '* * * * *', run: runEconomyEvents },
  { name: 'quiz', schedule: '* * * * *', run: runQuiz },
  { name: 'lottery', schedule: '* * * * *', run: runLottery },
  { name: 'chat_engagement', schedule: '* * * * *', run: runChatEngagement },
  { name: 'minecraft_chat', schedule: '* * * * *', run: syncChatBridges },
  { name: 'minecraft_backup', schedule: '* * * * *', run: runBackups },
  { name: 'minecraft_live', schedule: '* * * * *', run: pollMinecraftLive },
  { name: 'stock_market', schedule: '* * * * *', run: runStockMarket },
  { name: 'clubs_week', schedule: '* * * * *', run: runClubs },
  { name: 'seasonal_events', schedule: '* * * * *', run: runSeasonalEvents },
  { name: 'data_backup', schedule: '* * * * *', run: runDataBackups },
  { name: 'reminders', schedule: '* * * * *', run: runReminders },
  { name: 'economy_stats', schedule: '* * * * *', run: runEconomyStats },
];

/** Register an extra scheduled job (used by feature modules that load later). */
export function registerJob(name, schedule, run) {
  JOBS.push({ name, schedule, run });
}

export function startFeatureJobs(client) {
  for (const job of JOBS) {
    // The trace names the job, so money it pays out shows under that job in the economy statistics.
    cron.schedule(job.schedule, runSafeTask(job.name, () => runWithTraceContext({ traceId: createTraceId('job'), command: `job:${job.name}` }, () => job.run(client))));
  }
  logger.info(`Feature jobs scheduled: ${JOBS.map((job) => job.name).join(', ')}`);
}

/** Runs once after login. */
export async function initFeatures(client) {
  // Embeds use the bot's own avatar next to the brand name in footers.
  if (botConfig.embeds?.footer && !botConfig.embeds.footer.icon) {
    botConfig.embeds.footer.icon = client.user.displayAvatarURL({ size: 64 });
  }

  await cacheAllInvites(client).catch((error) => logger.warn(`Invite cache failed: ${error.message}`));
  // Owner's one-time request (2026-10-26): every warning on every server back to zero.
  await resetAllWarningsOnce(client).catch((error) => logger.warn(`Warnings reset failed: ${error.message}`));
}
