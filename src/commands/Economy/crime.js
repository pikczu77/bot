import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { progressEmbeds, recordProgress } from '../../services/progress.js';
import { addSeasonReward, noteSeasonGifts, seasonGiftText } from '../../services/seasonalEvents.js';
import { cooldownMs, earningsLine, getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import { earningMultiplier, staminaCooldown, upgradeBonusLine } from '../../services/economyUpgrades.js';
import { assertNotJailed, bailOffer } from '../../services/economyJail.js';
import { t } from '../../i18n/index.js';

const BALACLAVA_BONUS = 0.15;

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

            const economySettings = await getEconomySettings(guildId);
            const settings = economySettings.commands.crime;
            const JAIL_TIME = cooldownMs(settings.jailMinutes);

            const userData = await getEconomyData(client, guildId, userId);
            const CRIME_COOLDOWN = staminaCooldown(userData, cooldownMs(settings.cooldownMinutes));
            const lastCrime = userData.cooldowns?.crime || 0;
            assertNotJailed(userData, now, { settings: economySettings, guildId });

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

            // A Balaclava lowers the risk of this one crime by 15 points.
            const usedBalaclava = (userData.inventory?.balaclava || 0) > 0;
            if (usedBalaclava) userData.inventory = { ...userData.inventory, balaclava: userData.inventory.balaclava - 1 };
            const isSuccess = Math.random() > Math.max(0, crime.risk - (usedBalaclava ? BALACLAVA_BONUS : 0));
            const haul = Math.floor(Math.random() * (crime.max - crime.min + 1)) + crime.min;
            const amountEarned = isSuccess ? scaleEarnings(economySettings, haul * settings.payoutPercent / 100 * earningMultiplier(userData, 'crime'), userData) : 0;

            userData.cooldowns = userData.cooldowns || {};
            userData.cooldowns.crime = now;

            if (isSuccess) {
                userData.wallet = (userData.wallet || 0) + amountEarned;
                const progress = recordProgress(userData, { crime: 1, crimeWin: 1, earned: amountEarned }, { settings: economySettings, now });
                const gifts = await addSeasonReward(guildId, userData, 'job', { now });

                await setEconomyData(client, guildId, userId, userData);
                await noteSeasonGifts(guildId, userId, gifts);

                const embed = successEmbed(
                    t("🕵️ Crime Successful!"),
                    t`You successfully committed ${crime.name} and earned **${money(guildId, amountEarned)}**!` + upgradeBonusLine(userData, 'crime', guildId)
                    + earningsLine(economySettings, userData) + (usedBalaclava ? t`\n🥷 **Balaclava** used: +15% success chance.` : '')
                    + (gifts.length ? `\n${seasonGiftText(gifts)}` : '')
                );
                
                await InteractionHelper.safeEditReply(interaction, { embeds: [embed, ...progressEmbeds(progress, guildId)] });
            } else {
                // Fine is based on the potential haul of the attempted crime
                const potentialHaul = Math.floor((crime.min + crime.max) / 2 * settings.payoutPercent / 100);
                const fine = Math.min(Math.floor(potentialHaul * settings.finePercent / 100), userData.wallet || 0);
                const insured = fine > 0 && (userData.inventory?.insurance || 0) > 0;
                if (insured) userData.inventory = { ...userData.inventory, insurance: userData.inventory.insurance - 1 };
                else userData.wallet = Math.max(0, (userData.wallet || 0) - fine);
                userData.jailedUntil = JAIL_TIME > 0 ? now + JAIL_TIME : 0;
                const progress = recordProgress(userData, { crime: 1, jail: JAIL_TIME > 0 ? 1 : 0 }, { settings: economySettings, now });
                
                await setEconomyData(client, guildId, userId, userData);

                const bail = JAIL_TIME > 0 ? bailOffer(economySettings, guildId) : { text: '', components: [] };
                const embed = warningEmbed(
                    t("🚔 Crime Failed!"),
                    t`You were caught while attempting ${crime.name} and have been sent to jail! ` +
                    (insured
                        ? t`Your **Insurance** paid the fine of ${money(guildId, fine)}. You will be in jail for ${formatDuration(JAIL_TIME)}.`
                        : t`You were fined ${money(guildId, fine)} and will be in jail for ${formatDuration(JAIL_TIME)}.`)
                    + bail.text
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed, ...progressEmbeds(progress, guildId)], components: bail.components });
            }
    }, { command: 'crime' })
};