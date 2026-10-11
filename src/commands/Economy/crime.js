import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { cooldownMs, getEconomySettings, money } from '../../services/economySettings.js';
import { t } from '../../i18n/index.js';

const CRIME_TYPES = [
    { name: t("Pickpocketing"), min: 100, max: 500, risk: 0.3 },
    { name: t("Burglary"), min: 300, max: 1000, risk: 0.4 },
    { name: t("Bank Heist"), min: 1000, max: 5000, risk: 0.6 },
    { name: t("Art Theft"), min: 2000, max: 10000, risk: 0.7 },
    { name: t("Cybercrime"), min: 5000, max: 20000, risk: 0.8 },
];

export default {
    data: new SlashCommandBuilder()
        .setName('crime')
        .setDescription('Commit a crime to earn money (risky)')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Type of crime to commit')
                .setRequired(true)
                .addChoices(
                    { name: 'Pickpocketing', value: 'pickpocketing' },
                    { name: 'Burglary', value: 'burglary' },
                    { name: 'Bank Heist', value: 'bank-heist' },
                    { name: 'Art Theft', value: 'art-theft' },
                    { name: 'Cybercrime', value: 'cybercrime' },
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        await InteractionHelper.safeDefer(interaction);
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const settings = (await getEconomySettings(guildId)).commands.crime;
            const CRIME_COOLDOWN = cooldownMs(settings.cooldownMinutes);
            const JAIL_TIME = cooldownMs(settings.jailMinutes);

            const userData = await getEconomyData(client, guildId, userId);
            const lastCrime = userData.cooldowns?.crime || 0;
            const isJailed = userData.jailedUntil && userData.jailedUntil > now;

            if (isJailed) {
                const timeLeft = Math.ceil((userData.jailedUntil - now) / (1000 * 60));
                throw createError(
                    "User is in jail",
                    ErrorTypes.RATE_LIMIT,
                    t`You're in jail for ${timeLeft} more minutes!`,
                    { jailTimeRemaining: userData.jailedUntil - now }
                );
            }

            if (now < lastCrime + CRIME_COOLDOWN) {
                const timeLeft = Math.ceil((lastCrime + CRIME_COOLDOWN - now) / (1000 * 60));
                throw createError(
                    "Crime cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    t`You need to wait ${timeLeft} more minutes before committing another crime.`,
                    { remaining: lastCrime + CRIME_COOLDOWN - now, cooldownType: 'crime' }
                );
            }

            const crimeType = interaction.options.getString("type").toLowerCase();
            const crime = CRIME_TYPES.find(
                c => c.name.toLowerCase().replace(/\s+/g, '-') === crimeType
            );

            if (!crime) {
                throw createError(
                    "Invalid crime type",
                    ErrorTypes.VALIDATION,
                    t("Please select a valid crime type."),
                    { crimeType }
                );
            }

            const isSuccess = Math.random() > crime.risk;
            const haul = Math.floor(Math.random() * (crime.max - crime.min + 1)) + crime.min;
            const amountEarned = isSuccess ? Math.floor(haul * settings.payoutPercent / 100) : 0;

            userData.cooldowns = userData.cooldowns || {};
            userData.cooldowns.crime = now;

            if (isSuccess) {
                userData.wallet = (userData.wallet || 0) + amountEarned;
                
                await setEconomyData(client, guildId, userId, userData);
                
                const embed = successEmbed(
                    t("🕵️ Crime Successful!"),
                    t`You successfully committed ${crime.name} and earned **${money(guildId, amountEarned)}**!`
                );
                
                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } else {
                // Fine is based on the potential haul of the attempted crime
                const potentialHaul = Math.floor((crime.min + crime.max) / 2 * settings.payoutPercent / 100);
                const fine = Math.min(Math.floor(potentialHaul * settings.finePercent / 100), userData.wallet || 0);
                userData.wallet = Math.max(0, (userData.wallet || 0) - fine);
                userData.jailedUntil = JAIL_TIME > 0 ? now + JAIL_TIME : 0;
                
                await setEconomyData(client, guildId, userId, userData);
                
                const embed = warningEmbed(
                    t("🚔 Crime Failed!"),
                    t`You were caught while attempting ${crime.name} and have been sent to jail! ` +
                    t`You were fined ${money(guildId, fine)} and will be in jail for ${formatDuration(JAIL_TIME)}.`
                );
                
                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            }
    }, { command: 'crime' })
};