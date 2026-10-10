// ticket_members.js — /ticket add, /ticket remove, /ticket rename.

import { PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getTicketPermissionContext } from '../../../utils/ticket/ticketPermissions.js';
import { logger } from '../../../utils/logger.js';
import { t } from '../../../i18n/index.js';

export const TICKET_MEMBER_SUBCOMMANDS = new Set(['add', 'remove', 'rename']);

const MEMBER_ACCESS = {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
};

export async function handleTicketMemberCommand(interaction, client, subcommand) {
    const context = await getTicketPermissionContext({ client, interaction });

    if (!context.ticketData) {
        return replyUserError(interaction, {
            type: ErrorTypes.VALIDATION,
            message: t('This command can only be used in a valid ticket channel.'),
        });
    }

    if (!context.canManageTicket) {
        return replyUserError(interaction, {
            type: ErrorTypes.PERMISSION,
            message: t('You must have **Manage Channels** or the configured **Ticket Staff Role**.'),
        });
    }

    const channel = interaction.channel;
    if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) {
        return replyUserError(interaction, {
            type: ErrorTypes.PERMISSION,
            message: t('I need the **Manage Channels** permission in this ticket.'),
        });
    }

    try {
        if (subcommand === 'rename') {
            const name = interaction.options.getString('name').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 90);
            if (!name) {
                return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('That name has no usable characters.') });
            }
            await channel.setName(name, `Ticket renamed by ${interaction.user.tag}`);
            return InteractionHelper.safeEditReply(interaction, { embeds: [successEmbed(t`Ticket renamed to **${name}**.`)] });
        }

        const user = interaction.options.getUser('user');
        if (user.bot) {
            return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('Bots cannot be added to tickets.') });
        }

        if (subcommand === 'add') {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('The target user is not currently in this server.') });
            }
            await channel.permissionOverwrites.edit(user.id, MEMBER_ACCESS, { reason: `Added to ticket by ${interaction.user.tag}` });
            await channel.send({
                embeds: [createEmbed({ description: t`➕ ${user} was added to this ticket by ${interaction.user}.`, color: 'success', footer: false })],
                allowedMentions: { users: [user.id] },
            }).catch(() => {});
            return InteractionHelper.safeEditReply(interaction, { embeds: [successEmbed(t`${user} can now see this ticket.`)] });
        }

        if (String(context.ticketData.userId) === String(user.id)) {
            return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('The ticket creator cannot be removed. Close the ticket instead.') });
        }
        await channel.permissionOverwrites.delete(user.id, `Removed from ticket by ${interaction.user.tag}`);
        await channel.send({
            embeds: [createEmbed({ description: t`➖ ${user} was removed from this ticket by ${interaction.user}.`, color: 'warning', footer: false })],
            allowedMentions: { parse: [] },
        }).catch(() => {});
        return InteractionHelper.safeEditReply(interaction, { embeds: [successEmbed(t`${user} can no longer see this ticket.`)] });
    } catch (error) {
        logger.error('Ticket member command failed:', error);
        return replyUserError(interaction, {
            type: ErrorTypes.PERMISSION,
            message: t('I could not change this ticket. Check my permissions in the ticket category.'),
        });
    }
}
