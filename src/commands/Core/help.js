import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from "../../utils/embeds.js";
import {
    createSelectMenu,
} from "../../utils/components.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { t } from '../../i18n/index.js';
import { categoryIcon, formatCategoryName } from '../../config/commands/helpCategories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_SELECT_ID = "help-category-select";
const ALL_COMMANDS_ID = "help-all-commands";
const BUG_REPORT_BUTTON_ID = "help-bug-report";
const HELP_MENU_TIMEOUT_MS = 5 * 60 * 1000;



export async function createInitialHelpMenu(client) {
    const commandsPath = path.join(__dirname, "../../commands");
    const categoryDirs = (
        await fs.readdir(commandsPath, { withFileTypes: true })
    )
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

    const options = [
        {
            label: t("📋 All Commands"),
            description: t("Browse every available command in a single list"),
            value: ALL_COMMANDS_ID,
        },
        ...categoryDirs.map((category) => {
            const categoryName = formatCategoryName(category);
            const icon = categoryIcon(category);
            return {
                label: `${icon} ${categoryName}`,
                description: t`View commands in the ${categoryName} category`,
                value: category,
            };
        }),
    ];

    const botName = client?.user?.username || t("Bot");
    const embed = createEmbed({
        title: t`📖 ${botName} Help`,
        description: t('Set up your server, pick what to enable, then browse commands below.'),
        color: 'primary',
        thumbnail: client.user?.displayAvatarURL?.({ size: 1024 }),
        fields: [
            {
                name: t('🚀 Getting Started'),
                value: [
                    t('**1. Launch setup** — Set everything up in the web panel: pikczu.pl/bot.'),
                    t('**2. Enable systems** — Use `/komendy dashboard` to turn categories on or off.'),                    t('**3. Browse commands** — Use the menu below to view categories and commands.'),
                ].join('\n'),
                inline: false,
            },
            {
                name: t('ℹ️ How It Works'),
                value: [
                    t('• The web panel manages each feature visually'),
                    t('• Settings are saved per server'),
                    t('• Slash commands and prefixes both work once enabled'),
                ].join('\n'),
                inline: false,
            },
        ],
    });

    embed.setFooter({ 
        text: t("Made with ❤️") 
    });
    embed.setTimestamp();

    const bugReportButton = new ButtonBuilder()
        .setCustomId(BUG_REPORT_BUTTON_ID)
        .setLabel(t("Report Bug"))
        .setStyle(ButtonStyle.Danger);

    const supportButton = new ButtonBuilder()
        .setLabel(t("Support Server"))
        .setURL("https://discord.gg/rWzN7MmfHu")
        .setStyle(ButtonStyle.Link);

    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        t("Select to view the commands"),
        options,
    );

    const buttonRow = new ActionRowBuilder().addComponents([
        bugReportButton,
        supportButton,
    ]);

    return {
        embeds: [embed],
        components: [buttonRow, selectRow],
    };
}

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName("pomoc")
        .setDescription("Displays the help menu with all available commands"),

    async execute(interaction, guildConfig, client) {
        
        const { MessageFlags } = await import('discord.js');
        await InteractionHelper.safeDefer(interaction);
        
        const { embeds, components } = await createInitialHelpMenu(client);

        await InteractionHelper.safeEditReply(interaction, {
            embeds,
            components,
        });

        setTimeout(async () => {
            try {
                if (!InteractionHelper.isInteractionValid(interaction)) {
                    return;
                }

                const closedEmbed = createEmbed({
                    title: t("Help menu closed"),
                    description: t("Help menu has been closed, use /pomoc again."),
                    color: "secondary",
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [closedEmbed],
                    components: [],
                });
            } catch (error) {
                logger.debug('Help menu close edit failed (interaction may have expired):', error?.message);
            }
        }, HELP_MENU_TIMEOUT_MS);
    },
};