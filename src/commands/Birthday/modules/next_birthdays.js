import { EmbedBuilder } from 'discord.js';
import { getUpcomingBirthdays } from '../../../services/birthdayService.js';
import { deleteBirthday } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { t } from '../../../i18n/index.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const next5 = await getUpcomingBirthdays(client, interaction.guildId, 5);

        if (next5.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(t('No Birthdays Found'))
                .setDescription(t('No birthdays have been set up in this server yet. Use `/birthday set` to add birthdays!'));
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        let displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                deleteBirthday(client, interaction.guildId, birthday.userId).catch(() => null);
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = t('🎉 **Today!**');
            } else if (birthday.daysUntil === 1) {
                timeUntil = t('📅 **Tomorrow!**');
            } else {
                timeUntil = t`In ${birthday.daysUntil} day${birthday.daysUntil > 1 ? 's' : ''}`;
            }
        }

        if (displayIndex === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(t('No Upcoming Birthdays'))
                .setDescription(t('No upcoming birthdays found for current server members.'));
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        let birthdayList = t`🎂 **Next 5 Upcoming Birthdays**\n\nHere are the next 5 birthdays in ${interaction.guild.name}:\n\n`;
        displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = t('🎉 **Today!**');
            } else if (birthday.daysUntil === 1) {
                timeUntil = t('📅 **Tomorrow!**');
            } else {
                timeUntil = t`In ${birthday.daysUntil} day${birthday.daysUntil > 1 ? 's' : ''}`;
            }

            birthdayList += t`${displayIndex}. **${member.displayName}**\n<@${birthday.userId}>\n📅 **Date:** ${birthday.monthName} ${birthday.day}\n⏰ **Time:** ${timeUntil}\n\n`;
        }

        birthdayList += t`Use /birthday set to add your birthday!`;

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(t('Next 5 Upcoming Birthdays'))
            .setDescription(birthdayList);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed]
        });

        logger.info('Next birthdays retrieved successfully', {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            upcomingCount: displayIndex,
            commandName: 'next_birthdays'
        });
    }
};