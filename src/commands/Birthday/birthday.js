import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import birthdaySet from './modules/birthday_set.js';
import birthdayInfo from './modules/birthday_info.js';
import birthdayList from './modules/birthday_list.js';
import birthdayRemove from './modules/birthday_remove.js';
import nextBirthdays from './modules/next_birthdays.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
export default {
    data: new SlashCommandBuilder()
        .setName('urodziny')
        .setDescription('Birthday system commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('ustaw')
                .setDescription('Set your birthday')
                .addIntegerOption(option =>
                    option
                        .setName('month')
                        .setDescription('Birth month (1-12)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(12)
                )
                .addIntegerOption(option =>
                    option
                        .setName('day')
                        .setDescription('Birth day (1-31)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(31)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('View birthday information')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to check birthday for')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('lista')
                .setDescription('List all birthdays in the server')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('usun')
                .setDescription('Remove your birthday')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('nastepne')
                .setDescription('Show upcoming birthdays')
        ),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'ustaw':
                return await birthdaySet.execute(interaction, config, client);
            case 'info':
                return await birthdayInfo.execute(interaction, config, client);
            case 'lista':
                return await birthdayList.execute(interaction, config, client);
            case 'usun':
                return await birthdayRemove.execute(interaction, config, client);
            case 'nastepne':
                return await nextBirthdays.execute(interaction, config, client);
            default:
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: t('Unknown subcommand') });
        }
    }
};