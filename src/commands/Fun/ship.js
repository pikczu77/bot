import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, formatProgressBar } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { t } from '../../i18n/index.js';

// The same two people always get the same score, whichever order they are given in.
function loveScore(firstId, secondId) {
    const [low, high] = [String(firstId), String(secondId)].sort();
    let hash = 2166136261;
    for (const char of `${low}:${high}`) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 101;
}

function shipName(first, second) {
    const head = first.slice(0, Math.ceil(first.length / 2));
    const tail = second.slice(Math.floor(second.length / 2));
    return `${head}${tail}`;
}

function verdict(score) {
    if (score >= 90) return { emoji: '💞', text: t('A perfect match!') };
    if (score >= 70) return { emoji: '💖', text: t('There is real chemistry here.') };
    if (score >= 50) return { emoji: '💗', text: t('This could work out.') };
    if (score >= 30) return { emoji: '💛', text: t('Better as friends.') };
    if (score >= 10) return { emoji: '💔', text: t('Not much of a spark.') };
    return { emoji: '🧊', text: t('Ice cold. Run.') };
}

export default {
    data: new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Ship two people and see their love percentage')
        .addUserOption((option) =>
            option.setName('first').setDescription('The first person').setRequired(true),
        )
        .addUserOption((option) =>
            option.setName('second').setDescription('The second person (defaults to you)'),
        ),

    async execute(interaction) {
        const first = interaction.options.getUser('first');
        const second = interaction.options.getUser('second') || interaction.user;

        if (!first) {
            throw new TitanBotError(
                'Missing ship target',
                ErrorTypes.USER_INPUT,
                t('Pick at least one person to ship.'),
                { subtype: 'invalid_user' },
            );
        }

        if (first.id === second.id) {
            throw new TitanBotError(
                'Cannot ship a user with themselves',
                ErrorTypes.VALIDATION,
                t('Pick two different people.'),
            );
        }

        const score = loveScore(first.id, second.id);
        const { emoji, text } = verdict(score);
        const firstName = first.displayName || first.username;
        const secondName = second.displayName || second.username;

        const embed = createEmbed({
            title: t`${emoji} ${firstName} + ${secondName}`,
            description: [
                `<@${first.id}> ❤️ <@${second.id}>`,
                '',
                `**${score}%** ${formatProgressBar(score, 100, 12).replace(/ \d+%$/, '')}`,
                text,
            ].join('\n'),
            color: 'fuchsia',
            fields: [{ name: t('Ship name'), value: `**${shipName(firstName, secondName)}**`, inline: true }],
            thumbnail: first.displayAvatarURL?.({ size: 256 }),
            footer: false,
        });

        await InteractionHelper.universalReply(interaction, { embeds: [embed] });
    },
};
