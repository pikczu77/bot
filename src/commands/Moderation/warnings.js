import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/moderation/warningService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("View all warnings for a user")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("User to check warnings for"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Warnings interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warnings',
            });
            return;
        }

        const target = interaction.options.getUser("target");
        const guildId = interaction.guildId;

        const validWarnings = await WarningService.getWarnings(guildId, target.id);
        const totalWarns = validWarnings.length;

        if (totalWarns === 0) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: `Warnings: ${target.tag}`,
                        description: t("This user has no recorded warnings."),
                    }).setColor(getColor('success')),
                ],
            });
            return;
        }

        const embed = createEmbed({
            title: `Warnings: ${target.tag}`,
            description: t`Total Warnings: **${totalWarns}**`,
        }).setColor(getColor('warning'));

        const warningFields = validWarnings
            .map((w, i) => {
                const discordTimestamp = Math.floor(w.timestamp / 1000);
                return {
                    name: t`[#${i + 1}] Reason: ${w.reason.substring(0, 100)}`,
                    value: t`**Moderator:** <@${w.moderatorId}>\n**Date:** <t:${discordTimestamp}:F> (<t:${discordTimestamp}:R>)`,
                    inline: false,
                };
            })
            .slice(0, 25);

        embed.addFields(warningFields);

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`warning_delete_specific:${target.id}:${interaction.user.id}`)
                .setLabel(t('Delete Specific Warning'))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`warning_clear_all:${target.id}:${interaction.user.id}`)
                .setLabel(t('Clear All Warnings'))
                .setStyle(ButtonStyle.Danger),
        );

        await logEvent({
            client,
            guild: interaction.guild,
            event: {
                action: "Warnings Viewed",
                target: `${target.tag} (${target.id})`,
                executor: `${interaction.user.tag} (${interaction.user.id})`,
                reason: t`Viewed ${totalWarns} warnings`,
                metadata: {
                    userId: target.id,
                    moderatorId: interaction.user.id,
                    totalWarnings: totalWarns,
                },
            },
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components: [actionRow] });
    },
};
