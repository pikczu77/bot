// The message with the "create ticket" button. Set up and posted from the web panel (src/api/panelApi.js).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { t } from '../../../i18n/index.js';

const PANEL_BUTTON_STYLES = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
};
export const TICKET_BUTTON_STYLES = Object.keys(PANEL_BUTTON_STYLES);
export const TICKET_PANEL_COLOR_RE = /^#[0-9a-f]{6}$/i;

// Title, colour of the side bar and colour of the button come from the settings; unset ones keep the defaults.
export function buildPanelEmbed(config) {
    return new EmbedBuilder()
        .setTitle(config.ticketPanelTitle || t('Support Tickets'))
        .setDescription(config.ticketPanelMessage || t('Click the button below to create a support ticket.'))
        .setColor(getColor(TICKET_PANEL_COLOR_RE.test(config.ticketPanelColor ?? '') ? config.ticketPanelColor : 'info'));
}

export function buildPanelButtonRow(config) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel(config.ticketButtonLabel || t('Create Ticket'))
            .setStyle(PANEL_BUTTON_STYLES[config.ticketButtonStyle] ?? ButtonStyle.Primary)
            .setEmoji('📩'),
    );
}
