import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { durationChoices, durationWords, requireDuration } from '../../utils/featureKit.js';
import { t } from '../../i18n/index.js';

const MAX_MUTE_MS = 28 * 86_400_000; // Discord's limit for a timeout
const PRESETS = ['5m', '10m', '30m', '1h', '3h', '6h', '12h', '1d', '2d', '3d', '5d', '1w', '2w', '3w', '4w'];

export default {
    data: new SlashCommandBuilder()
        .setName("mute")
        .setDescription("Timeout a user for a specific duration.")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("User to timeout")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("How long, for example 3 weeks, 2 days or 12h (at most 28 days)")
                .setRequired(true)
                .setAutocomplete(true),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Reason for the timeout"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async autocomplete(interaction) {
        await interaction.respond(durationChoices(interaction.options.getFocused(), { max: MAX_MUTE_MS, presets: PRESETS }));
    },

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Timeout interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'mute',
            });
            return;
        }

        const targetUser = interaction.options.getUser("target");
        const member = interaction.options.getMember("target");
        const rawDuration = interaction.options.getString("duration");
        const reason = interaction.options.getString("reason") || t("No reason provided");

        if (!targetUser) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                t('You must specify a user to timeout.'),
                { subtype: 'invalid_user' },
            );
        }

        if (targetUser.id === interaction.user.id) {
            throw new TitanBotError(
                "Cannot timeout self",
                ErrorTypes.VALIDATION,
                t("You cannot timeout yourself."),
            );
        }
        if (targetUser.id === client.user.id) {
            throw new TitanBotError(
                "Cannot timeout bot",
                ErrorTypes.VALIDATION,
                t("You cannot timeout the bot."),
            );
        }
        if (!member) {
            throw new TitanBotError(
                "Target not found",
                ErrorTypes.USER_INPUT,
                t("The target user is not currently in this server."),
            );
        }

        // `!mute @x 60` always meant minutes. The slash command refuses a lone number, so nobody mutes for 3 minutes instead of 3 days.
        const durationText = interaction._isPrefixCommand && /^\d+$/.test(rawDuration) ? `${rawDuration}m` : rawDuration;
        const durationMs = requireDuration(durationText, {
            min: 60_000,
            max: MAX_MUTE_MS,
            tooLong: t('Discord allows a timeout of at most 28 days. For longer use `/ban` with a duration.'),
        });
        const result = await ModerationService.timeoutUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            durationMs,
            reason,
        });

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    t`⏳ **Timed out** ${targetUser.tag} for ${durationWords(durationMs)}.`,
                    t`**Reason:** ${reason}\n**Case ID:** #${result.caseId}`,
                ),
            ],
        });
    },
};
