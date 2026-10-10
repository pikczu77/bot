import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { respond, requireGuild, requirePermission } from '../../utils/featureKit.js';
import { getGuildLocale, setGuildLocale } from '../../services/languageService.js';
import { LOCALE_INFO, SUPPORTED_LOCALES, switchLocale, t } from '../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName('language')
        .setDescription('Choose the language the bot uses on this server')
        .addStringOption((option) =>
            option
                .setName('language')
                .setDescription('Language to switch to (leave empty to see the current one)')
                .addChoices(...SUPPORTED_LOCALES.map((locale) => ({
                    name: `${LOCALE_INFO[locale].flag} ${LOCALE_INFO[locale].name}`,
                    value: locale,
                }))),
        ),

    async execute(interaction, guildConfig, client) {
        const guild = requireGuild(interaction);
        const requested = interaction.options.getString('language');

        if (!requested) {
            const current = await getGuildLocale(client, guild.id);
            const info = LOCALE_INFO[current];
            return respond(interaction, createEmbed({
                title: t('🌍 Server language'),
                description: [
                    t`The bot speaks **${`${info.flag} ${info.name}`}** on this server.`,
                    t('Change it with `/language` and pick a language from the list.'),
                ].join('\n'),
                footer: false,
            }), { ephemeral: true });
        }

        requirePermission(interaction, PermissionFlagsBits.ManageGuild);

        const locale = await setGuildLocale(client, guild.id, requested);
        // Answer in the language that was just chosen.
        switchLocale(locale);

        const info = LOCALE_INFO[locale];
        return respond(interaction, successEmbed(
            t('Language changed'),
            t`From now on the bot speaks **${`${info.flag} ${info.name}`}** on this server.`,
        ));
    },
};
