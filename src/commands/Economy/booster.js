import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { getBoostData, perkLines, perksOn } from '../../services/serverBoost.js';
import { t } from '../../i18n/index.js';

// /booster info — what a boost of the server gives (2026-11-01). Rules: services/serverBoost.js.
// Not /boosty: those are x2 potions bought with money.

export function buildBoosterView({ guild, member, settings, entry, now = Date.now() }) {
    const boost = settings.serverBoost;
    const boosting = Boolean(member?.premiumSinceTimestamp);
    const status = [];
    if (boosting) {
        status.push(t`💎 You boost this server since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:D>. Thank you!`);
        if (entry?.nextRewardAt > now) status.push(t`🎁 Next reward <t:${Math.floor(entry.nextRewardAt / 1000)}:R>.`);
    } else {
        status.push(t('You do not boost this server yet. Click the server name, then **Server Boost**.'));
    }
    const count = guild.premiumSubscriptionCount ?? 0;
    return createEmbed({
        title: t('💎 Boosting the server'),
        description: [
            ...status,
            '',
            ...(perksOn(settings) ? perkLines(guild.id, boost) : [t('⚠️ Booster rewards are turned off on this server.')]),
            '',
            t`-# The server has ${count} {0|boost|boosts}, level ${guild.premiumTier ?? 0}.`,
        ].join('\n'),
        color: '#F47FFF',
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('booster')
        .setDescription('What you get for boosting the server')
        .addSubcommand((sub) => sub
            .setName('info')
            .setDescription('Rewards for a boost and your status')),

    execute: withErrorHandling(async (interaction) => {
        const { guild, member } = interaction;
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const settings = await getEconomySettings(guild.id);
        const { members } = await getBoostData(guild.id);
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [buildBoosterView({ guild, member, settings, entry: members?.[member.id] })],
        });
    }, { command: 'booster' }),
};
