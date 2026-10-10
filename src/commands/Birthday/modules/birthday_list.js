import { EmbedBuilder } from 'discord.js';
import { getAllBirthdays } from '../../../services/birthdayService.js';
import { deleteBirthday } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { t } from '../../../i18n/index.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const guildId = interaction.guildId;

        const sortedBirthdays = await getAllBirthdays(client, guildId);

        if (sortedBirthdays.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(t('No Birthdays'))
                .setDescription(t('No birthdays have been set in this server yet.'));
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        const userIds = sortedBirthdays.map(b => b.userId);
        const fetchedMembers = await interaction.guild.members.fetch({ user: userIds }).catch(() => null);

        let birthdayList = '';
        let displayIndex = 0;
        const staleUserIds = [];

        for (const birthday of sortedBirthdays) {
            if (fetchedMembers && !fetchedMembers.has(birthday.userId)) {
                staleUserIds.push(birthday.userId);
                continue;
            }
            displayIndex++;
            birthdayList += `${displayIndex}. <@${birthday.userId}> - ${birthday.monthName} ${birthday.day}\n`;
        }

        if (fetchedMembers && staleUserIds.length > 0) {
            for (const userId of staleUserIds) {
                deleteBirthday(client, guildId, userId).catch(() => null);
            }
        }

        if (displayIndex === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(t('No Birthdays'))
                .setDescription(t('No birthdays have been set by current server members.'));
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        birthdayList = t`**${displayIndex} birthday${displayIndex !== 1 ? 's' : ''} in ${interaction.guild.name}**\n\n` + birthdayList;

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(t('Server Birthdays'))
            .setDescription(t`${birthdayList}\n\nTotal: ${displayIndex} birthday${displayIndex !== 1 ? 's' : ''}`);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed]
        });

        logger.info('Birthday list retrieved successfully', {
            userId: interaction.user.id,
            guildId,
            birthdayCount: displayIndex,
            staleRemoved: staleUserIds.length,
            commandName: 'birthday_list'
        });
    }
};