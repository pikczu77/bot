import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, infoEmbed } from '../../../utils/embeds.js';
import { respond, requireGuild, truncate } from '../../../utils/featureKit.js';
import { getGuildGiveaways, isGiveawayEnded } from '../../../utils/giveaways.js';
import { t } from '../../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName("glist")
        .setDescription("Shows running giveaways and the most recent finished ones.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const giveaways = await getGuildGiveaways(interaction.client, guild.id);
        if (giveaways.length === 0) {
            return respond(interaction, infoEmbed(t('No giveaways yet. Start one with `/konkurs utworz`.')), { ephemeral: true });
        }

        const link = (giveaway) => `https://discord.com/channels/${guild.id}/${giveaway.channelId}/${giveaway.messageId}`;
        const isOver = (giveaway) => giveaway.ended || giveaway.isEnded || isGiveawayEnded(giveaway);
        const running = giveaways.filter((giveaway) => !isOver(giveaway)).sort((a, b) => (a.endsAt ?? a.endTime) - (b.endsAt ?? b.endTime));
        const finished = giveaways.filter(isOver).sort((a, b) => (b.endsAt ?? b.endTime) - (a.endsAt ?? a.endTime)).slice(0, 5);

        const fields = [];
        if (running.length > 0) {
            fields.push({
                name: t`🟢 Running (${running.length})`,
                value: truncate(running.slice(0, 10).map((giveaway) =>
                    `**[${truncate(giveaway.prize, 60)}](${link(giveaway)})** — ${t`ends <t:${Math.floor((giveaway.endsAt ?? giveaway.endTime) / 1000)}:R>`} · ${t`${giveaway.participants?.length ?? 0} {0|entry|entries}`}`,
                ).join('\n'), 1024),
            });
        }
        if (finished.length > 0) {
            fields.push({
                name: t('⚫ Recently finished'),
                value: truncate(finished.map((giveaway) =>
                    `**[${truncate(giveaway.prize, 60)}](${link(giveaway)})** — ${(giveaway.winnerIds ?? []).map((id) => `<@${id}>`).join(', ') || t('no winner')}`,
                ).join('\n'), 1024),
            });
        }

        return respond(interaction, createEmbed({
            title: t('🎉 Giveaways'),
            description: t('End one early with `/konkurs zakoncz`, pick new winners with `/konkurs losuj-ponownie`.'),
            fields,
            footer: false,
        }), { ephemeral: true });
    },
};
