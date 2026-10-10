import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getTicketData, saveTicketData } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';
import { getColor } from '../../../config/bot.js';
import { logTicketFeedback } from '../../../utils/ticket/ticketLogging.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { t } from '../../../i18n/index.js';

function buildEmbed(title, description, color) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);
}

export default {
    name: 'ticket_feedback_comment_modal',

    async execute(interaction, client, args) {
        const [guildId, channelId] = args;

        if (!guildId || !channelId) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [buildEmbed(
                    t('⚠️ Invalid Feedback Submission'),
                    t('This feedback form appears to be malformed.'),
                    getColor('error'),
                )],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const comment = interaction.fields.getTextInputValue('feedback_comment')?.trim();
        if (!comment) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [buildEmbed(
                    t('⚠️ Empty Feedback'),
                    t('Please enter a comment before submitting your feedback.'),
                    getColor('warning'),
                )],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) {
            return;
        }

        let ticketData;
        try {
            ticketData = await getTicketData(guildId, channelId);
        } catch (err) {
            logger.warn('ticketFeedbackComment: failed to load ticket data', { guildId, channelId, error: err.message });
        }

        if (!ticketData) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildEmbed(
                    t('⚠️ Ticket Not Found'),
                    t('Could not find the ticket associated with this feedback.'),
                    getColor('error'),
                )],
            });
            return;
        }

        if (interaction.user.id !== ticketData.userId) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildEmbed(
                    t('❌ Not Allowed'),
                    t('Only the ticket creator can submit feedback for this ticket.'),
                    getColor('error'),
                )],
            });
            return;
        }

        ticketData.feedback = {
            ...ticketData.feedback,
            comment,
            commentSubmittedAt: new Date().toISOString(),
        };

        try {
            await saveTicketData(guildId, channelId, ticketData);
        } catch (err) {
            logger.error('ticketFeedbackComment: failed to save feedback', { guildId, channelId, error: err.message });
        }

        try {
            await logTicketFeedback({
                client: interaction.client,
                guildId,
                ticketNumber: ticketData.id,
                ticketChannelId: channelId,
                userId: interaction.user.id,
                rating: ticketData.feedback?.rating ?? null,
                comment,
            });
        } catch (err) {
            logger.warn('ticketFeedbackComment: failed to send log', { guildId, channelId, error: err.message });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [buildEmbed(
                t('✅ Feedback Submitted'),
                t('Your written feedback has been recorded. Thank you for helping us improve!'),
                getColor('success'),
            )],
        });

        logger.info('Ticket feedback comment submitted', {
            guildId,
            channelId,
            userId: interaction.user.id,
        });
    },
};
