import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { parseDuration } from '../../utils/featureKit.js';
import { tempban } from './modules/modTools.js';
import { t } from '../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user from the server")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to ban")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Reason for the ban"),
        )
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("Empty = permanent ban. Or for example 3 weeks, 2 days, 1 month")
                .setAutocomplete(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",
    autocomplete: tempban.autocomplete,

    async execute(interaction, config, client) {
        // `!ban @x spam hard` puts the second word here; only a real duration makes it a temporary ban.
        const duration = interaction.options.getString("duration");
        if (duration && (!interaction._isPrefixCommand || parseDuration(duration))) {
            return tempban.execute(interaction, config, client);
        }

        const user = interaction.options.getUser("target");
        const reason = interaction.options.getString("reason") || t("No reason provided");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                t('You must specify a user to ban.'),
                { subtype: 'invalid_user' },
            );
        }

        if (user.id === interaction.user.id) {
            throw new TitanBotError(
                'Cannot ban self',
                ErrorTypes.VALIDATION,
                t('You cannot ban yourself.'),
            );
        }
        if (user.id === client.user.id) {
            throw new TitanBotError(
                'Cannot ban bot',
                ErrorTypes.VALIDATION,
                t('You cannot ban the bot.'),
            );
        }

        const result = await ModerationService.banUser({
            guild: interaction.guild,
            user,
            moderator: interaction.member,
            reason,
        });

        await InteractionHelper.universalReply(interaction, {
            embeds: [
                successEmbed(
                    t`🚫 **Banned** ${user.tag}`,
                    t`**Reason:** ${reason}\n**Case ID:** #${result.caseId}`,
                ),
            ],
        });
    },
};
