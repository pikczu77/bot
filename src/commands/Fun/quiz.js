import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { requireBotPermission, userError } from '../../utils/featureKit.js';
import { getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import { getQuizSettings, postQuestion, runningQuestion, updateQuizSettings } from '../../services/quiz.js';
import { QUIZ_QUESTIONS } from '../../config/quizQuestions.js';
import { t } from '../../i18n/index.js';

// /quiz pytanie | ustaw — quiz questions with a money prize (2026-10-26). Rules: services/quiz.js.

const CHANNEL_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

async function statusEmbed(guildId, notice = '') {
    const settings = await getQuizSettings(guildId);
    const economy = await getEconomySettings(guildId);
    const lines = [
        notice,
        settings.channelId ? t`📢 Channel: <#${settings.channelId}>` : t('📢 Channel: none (questions from `/quiz pytanie` go to the channel where it is used).'),
        t`💰 Prize: **${money(guildId, scaleEarnings(economy, settings.reward))}** for the first right answer`,
        settings.auto
            ? t`🔁 Automatic: a question about every **${settings.everyMinutes} min** when someone writes on the channel`
            : t('🔁 Automatic questions: off'),
        t`📚 Questions: **${QUIZ_QUESTIONS.length}**`,
    ].filter(Boolean);
    return createEmbed({ title: t('🧠 Quiz'), description: lines.join('\n'), color: '#5865F2', footer: false });
}

export default {
    data: new SlashCommandBuilder()
        .setName('quiz')
        .setDescription('Quiz questions with a money prize for the first right answer')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((sub) => sub
            .setName('pytanie')
            .setDescription('Post a quiz question now'))
        .addSubcommand((sub) => sub
            .setName('ustaw')
            .setDescription('Quiz channel, prize and automatic questions')
            .addChannelOption((option) => option
                .setName('kanal')
                .setDescription('Channel for quiz questions')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addBooleanOption((option) => option
                .setName('automatyczny')
                .setDescription('Post questions by itself when people talk on the channel'))
            .addIntegerOption((option) => option
                .setName('co_ile_minut')
                .setDescription('Automatic questions: at most one every this many minutes (10-1440)')
                .setMinValue(10)
                .setMaxValue(1440))
            .addIntegerOption((option) => option
                .setName('nagroda')
                .setDescription('Prize for the first right answer')
                .setMinValue(0)
                .setMaxValue(1_000_000))),

    execute: withErrorHandling(async (interaction) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;
        const guild = interaction.guild;

        if (interaction.options.getSubcommand() === 'pytanie') {
            const settings = await getQuizSettings(guild.id);
            const channel = (settings.channelId && guild.channels.cache.get(settings.channelId)) || interaction.channel;
            requireBotPermission(guild, CHANNEL_PERMISSIONS, channel);
            if (runningQuestion(guild.id)) throw userError(t('A question is still running. Wait until it ends.'));
            await postQuestion(guild, channel);
            return InteractionHelper.safeEditReply(interaction, { embeds: [await statusEmbed(guild.id, t`✅ Question posted in ${channel}.`)] });
        }

        const channel = interaction.options.getChannel('kanal');
        if (channel) requireBotPermission(guild, CHANNEL_PERMISSIONS, channel);
        const auto = interaction.options.getBoolean('automatyczny');
        const everyMinutes = interaction.options.getInteger('co_ile_minut');
        const reward = interaction.options.getInteger('nagroda');
        const saved = await updateQuizSettings(guild.id, (settings) => {
            if (channel) settings.channelId = channel.id;
            if (auto !== null) settings.auto = auto;
            if (everyMinutes) settings.everyMinutes = everyMinutes;
            if (reward !== null) settings.reward = reward;
        });
        const notice = saved.auto && !saved.channelId ? t('⚠️ Automatic questions need a channel: add `kanal`.') : t('✅ Saved.');
        return InteractionHelper.safeEditReply(interaction, { embeds: [await statusEmbed(guild.id, notice)] });
    }, { command: 'quiz' })
};
