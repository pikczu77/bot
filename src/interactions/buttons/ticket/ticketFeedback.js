import { EmbedBuilder, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getTicketData, saveTicketData } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';
import { getColor } from '../../../config/bot.js';
import { logTicketFeedback } from '../../../utils/ticket/ticketLogging.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { t } from '../../../i18n/index.js';

const STAR_LABELS = {
    '1': t('⭐ 1 — Poor'),
    '2': t('⭐ 2 — Below Average'),
    '3': t('⭐ 3 — Average'),
    '4': t('⭐ 4 — Good'),
    '5': t('⭐ 5 — Excellent'),
};

const feedbackHandler = {
    name: 'ticket_feedback',

    async execute(interaction, client, args) {
        
        const [guildId, channelId, ratingStr] = args;

        if (!guildId || !channelId || !ratingStr) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setTitle(t('⚠️ Invalid Feedback Link'))
                        .setDescription(t('This feedback link appears to be malformed.'))
                        .setColor(getColor('error')),
                ],
                components: [],
            });
            return;
        }

        try {
            await interaction.deferUpdate();
        } catch (err) {
            logger.warn('ticketFeedback: interaction expired before deferUpdate', { guildId, channelId, error: err.message });
            return;
        }

        let ticketData;
        try {
            ticketData = await getTicketData(guildId, channelId);
        } catch (err) {
            logger.warn('ticketFeedback: failed to load ticket data', { guildId, channelId, error: err.message });
        }

        if (!ticketData) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setTitle(t('⚠️ Ticket Not Found'))
                        .setDescription(t('Could not find the ticket associated with this survey.'))
                        .setColor(getColor('error')),
                ],
                components: [],
            });
            return;
        }

        if (interaction.user.id !== ticketData.userId) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setTitle(t('❌ Not Allowed'))
                        .setDescription(t('Only the ticket creator can submit feedback for this ticket.'))
                        .setColor(getColor('error')),
                ],
                components: [],
            });
            return;
        }

        if (ticketData.feedback?.rating) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setTitle(t('✅ Already Submitted'))
                        .setDescription(t`You already rated this ticket **${STAR_LABELS[String(ticketData.feedback.rating)]}**.\nThank you for your feedback!`)
                        .setColor(getColor('success')),
                ],
                components: [],
            });
            return;
        }

        const rating = parseInt(ratingStr, 10);
        const ratingLabel = STAR_LABELS[String(rating)] ?? `${rating} stars`;

        try {
            ticketData.feedback = {
                rating,
                submittedAt: new Date().toISOString(),
            };
            await saveTicketData(guildId, channelId, ticketData);
        } catch (err) {
            logger.error('ticketFeedback: failed to save feedback', { guildId, channelId, rating, error: err.message });
        }

        try {
            await logTicketFeedback({
                client: interaction.client,
                guildId,
                ticketNumber: ticketData.id,
                ticketChannelId: channelId,
                userId: interaction.user.id,
                rating,
            });
        } catch (err) {
            logger.warn('ticketFeedback: failed to send log', { guildId, channelId, error: err.message });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle(t('✅ Thanks for your feedback!'))
                    .setDescription(t`You rated your support experience **${ratingLabel}**.\n\nYour feedback has been recorded and helps us improve!`)
                    .setColor(getColor('success'))
                    .setFooter({ text: t('Thank you for using our support system.') })
                    .setTimestamp(),
            ],
            components: [],
        });

        logger.info('Ticket feedback submitted', {
            guildId,
            channelId,
            userId: interaction.user.id,
            rating,
        });
    },
};

const commentHandler = {
    name: 'ticket_feedback_comment',

    async execute(interaction, client, args) {
        const [guildId, channelId] = args;

        if (!guildId || !channelId) {
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(t('⚠️ Invalid Feedback Link'))
                        .setDescription(t('This feedback action appears to be malformed.'))
                        .setColor(getColor('error')),
                ],
                components: [],
            });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`ticket_feedback_comment_modal:${guildId}:${channelId}`)
            .setTitle(t('Add Ticket Feedback'));

        const commentInput = new TextInputBuilder()
            .setCustomId('feedback_comment')
            .setLabel(t('Your feedback'))
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(t('Share what went well or how we can improve...'))
            .setRequired(true)
            .setMaxLength(1000);

        modal.addComponents(new ActionRowBuilder().addComponents(commentInput));

        await interaction.showModal(modal);
    },
};

const declineHandler = {
    name: 'ticket_feedback_decline',

    async execute(interaction) {
        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle(t('👋 No problem!'))
                    .setDescription(t('You can always reach out again if you need further support.'))
                    .setColor(getColor('default')),
            ],
            components: [],
        });
    },
};

export default [feedbackHandler, commentHandler, declineHandler];