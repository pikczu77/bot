import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { money } from '../../services/economySettings.js';

export default {
    data: new SlashCommandBuilder()
        .setName('balans')
        .setDescription("Check your or someone else's balance")
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to check balance for')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userOption = interaction.options.getUser("user");
        const targetUser = userOption || interaction.user;
        const guildId = interaction.guildId;

        logger.info(`[ECONOMY] Balance check - userOption: ${userOption?.id || 'null'}, targetUser: ${targetUser.id}, guildId: ${guildId}, isPrefix: ${!!interaction._commandStartTime}`);

        logger.debug(`[ECONOMY] Balance check for ${targetUser.id}`, { userId: targetUser.id, guildId });

        if (targetUser.bot) {
            throw createError(
                "Bot user queried for balance",
                ErrorTypes.VALIDATION,
                t("Bots don't have an economy balance.")
            );
        }

        const userData = await getEconomyData(client, guildId, targetUser.id);

        logger.info(`[ECONOMY] Economy data retrieved - userData:`, userData);

        if (!userData) {
            throw createError(
                "Failed to load economy data",
                ErrorTypes.DATABASE,
                t("Failed to load economy data. Please try again later."),
                { userId: targetUser.id, guildId }
            );
        }

        const maxBank = getMaxBankCapacity(userData);

        const wallet = typeof userData.wallet === 'number' ? userData.wallet : 0;
        const bank = typeof userData.bank === 'number' ? userData.bank : 0;

            const embed = createEmbed({
                title: t`${targetUser.username}'s Balance`,
                description: t`Here is the current financial status for ${targetUser.username}.`
                    + (userData._joint ? `\n${t`🏦 Joint bank with <@${userData._joint.partnerId}>`}` : ''),
            })
                .addFields(
                    {
                        name: t("💵 Cash"),
                        value: `${money(guildId, wallet)}`,
                        inline: true,
                    },
                    {
                        name: t("🏦 Bank"),
                        value: `${money(guildId, bank)} / ${money(guildId, maxBank)}`,
                        inline: true,
                    },
                    {
                        name: t("💰 Total"),
                        value: `${money(guildId, (wallet + bank))}`,
                        inline: true,
                    }
                )
                .setFooter({
                    text: t`Requested by ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL(),
                });

            logger.info(`[ECONOMY] Balance retrieved`, { userId: targetUser.id, wallet, bank });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'balans' })
};