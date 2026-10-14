import { SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { formatDuration } from '../../utils/embeds.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money } from '../../services/economySettings.js';
import { DATE_PLACES, dateCooldownLeft, getDatePlace, getPair } from '../../services/marriageService.js';
import { buildDateInvite } from './modules/relationships.js';
import { t, tr } from '../../i18n/index.js';

// Invite someone on a date. The other person accepts with a button (modules/relationships.js);
// the date is scored from the /ship percentage, the place and luck, and the pair collects
// hearts. Married couples get a bonus.
export default {
    data: new SlashCommandBuilder()
        .setName('randka')
        .setDescription('Ask someone out on a date')
        .setDMPermission(false)
        .addUserOption((option) =>
            option.setName('osoba').setDescription('Who you want to go on a date with').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('miejsce')
                .setDescription('Where you go (you pay)')
                .addChoices(...DATE_PLACES.map((place) => ({ name: `${place.emoji} ${place.name}`, value: place.id }))),
        ),

    async execute(interaction, config, client) {
        const target = interaction.options.getUser('osoba');
        const place = getDatePlace(interaction.options.getString('miejsce') ?? 'spacer') ?? DATE_PLACES[0];
        const { guildId, user } = interaction;

        if (!target) {
            throw new TitanBotError('Missing date target', ErrorTypes.USER_INPUT, t('Pick who you want to go on a date with.'), { subtype: 'invalid_user' });
        }
        if (target.id === user.id) {
            throw new TitanBotError('Date with self', ErrorTypes.VALIDATION, t('A date with yourself? Pick someone else.'));
        }
        if (target.bot) {
            throw new TitanBotError('Date with a bot', ErrorTypes.VALIDATION, t('Bots do not go on dates.'));
        }

        const left = dateCooldownLeft(await getPair(guildId, user.id, target.id));
        if (left > 0) {
            throw new TitanBotError('Date cooldown', ErrorTypes.RATE_LIMIT, t`You two were on a date not long ago. Next date in **${formatDuration(left)}**.`);
        }

        if (place.price > 0) {
            await getEconomySettings(guildId);
            const data = await getEconomyData(client, guildId, user.id);
            const funds = (data.wallet || 0) + (data.bank || 0);
            if (funds < place.price) {
                throw new TitanBotError(
                    'Cannot afford the date',
                    ErrorTypes.VALIDATION,
                    t`**${place.emoji} ${tr(place.name)}** costs **${money(guildId, place.price)}**, you have **${money(guildId, funds)}** (cash and bank). Pick a cheaper place.`,
                );
            }
        }

        await InteractionHelper.universalReply(interaction, await buildDateInvite({ guildId, inviterId: user.id, targetId: target.id, place }));
    },
};
