import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { ROLE_NAME_MAX, getBoostData, perkLines, perksOn, removeBoosterRole, setBoosterRole } from '../../services/serverBoost.js';
import { t } from '../../i18n/index.js';

// /booster info | rola | usun-role — what a boost of the server gives (2026-11-01). Rules: services/serverBoost.js.
// Not /boosty: those are x2 potions bought with money.

export function buildBoosterView({ guild, member, settings, entry, now = Date.now() }) {
    const boost = settings.serverBoost;
    const boosting = Boolean(member?.premiumSinceTimestamp);
    const status = [];
    if (boosting) {
        status.push(t`💎 You boost this server since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:D>. Thank you!`);
        if (entry?.nextRewardAt > now) status.push(t`🎁 Next reward <t:${Math.floor(entry.nextRewardAt / 1000)}:R>.`);
        const role = entry?.roleId ? guild.roles.cache.get(entry.roleId) : null;
        if (role) status.push(t`🎨 Your role: ${role.toString()}`);
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
            .setDescription('Rewards for a boost and your status'))
        .addSubcommand((sub) => sub
            .setName('rola')
            .setDescription('Your own role while you boost: name and colour')
            .addStringOption((option) => option.setName('nazwa').setDescription('Name of the role').setRequired(true).setMaxLength(ROLE_NAME_MAX))
            .addStringOption((option) => option.setName('kolor').setDescription('Colour as a hex code, for example #ff66cc').setRequired(true).setMaxLength(7)))
        .addSubcommand((sub) => sub
            .setName('usun-role')
            .setDescription('Remove your own role')),

    execute: withErrorHandling(async (interaction) => {
        const sub = interaction.options.getSubcommand();
        const { guild, member } = interaction;
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        if (sub === 'rola') {
            const role = await setBoosterRole({
                guild, member, name: interaction.options.getString('nazwa'), color: interaction.options.getString('kolor'),
            });
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ description: t`🎨 Your role is ready: ${role.toString()}. It goes away when the boost ends.`, color: '#F47FFF', footer: false })],
            });
        }
        if (sub === 'usun-role') {
            if (!await removeBoosterRole(guild, member.id)) throw userError(t('You have no own role.'));
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ description: t('🎨 Your role is gone.'), color: '#F47FFF', footer: false })],
            });
        }

        const settings = await getEconomySettings(guild.id);
        const { members } = await getBoostData(guild.id);
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [buildBoosterView({ guild, member, settings, entry: members?.[member.id] })],
        });
    }, { command: 'booster' }),
};
