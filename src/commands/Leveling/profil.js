import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money } from '../../services/economySettings.js';
import { getUserLevelData, getXpForLevel } from '../../services/leveling/leveling.js';
import { getSpouseId } from '../../services/marriageService.js';
import { CARDS, FISH, cardsCollected, fishCollected } from '../../services/collections.js';
import { ACHIEVEMENTS, isUnlocked } from '../../services/progress.js';
import { renderProfileCard } from '../../services/profileCard.js';
import { t, tr } from '../../i18n/index.js';

// /profil [osoba] — one picture with level, money, collections, badges and spouse (2026-10-26).
// Picture: services/profileCard.js. Buttons profil:odznaki|misje:<userId> open the full lists privately
// (interactions/buttons/leveling/profile.js).

const DEFAULT_ACCENT = '#5865F2';
const BADGES_ON_CARD = 6;
const thousands = (value) => String(Math.floor(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Everything the card shows, read from the stores. */
export async function profileData({ client, guild, user, member }) {
    await getEconomySettings(guild.id);
    const account = await getEconomyData(client, guild.id, user.id);
    const levelData = await getUserLevelData(client, guild.id, user.id);
    const level = Number(levelData?.level) || 0;
    const xp = Number(levelData?.xp) || 0;
    const xpNeeded = getXpForLevel(Math.min(level, 1000));
    const spouseId = await getSpouseId(guild.id, user.id);
    const spouse = spouseId
        ? (guild.members.cache.get(spouseId)?.displayName ?? (await client.users.fetch(spouseId).catch(() => null))?.username ?? null)
        : null;
    const unlocked = ACHIEVEMENTS
        .filter((achievement) => isUnlocked(account, achievement.id))
        .sort((a, b) => Number(account.achievements[b.id]) - Number(account.achievements[a.id]));
    const color = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : DEFAULT_ACCENT;

    return {
        name: member?.displayName ?? user.globalName ?? user.username,
        subtitle: [t`Level ${level}`, spouse ? t`married to ${spouse}` : null].filter(Boolean).join(' · '),
        avatarUrl: (member ?? user).displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: true }),
        accent: color.toUpperCase(),
        level,
        xp,
        xpNeeded,
        xpText: `${thousands(xp)} / ${thousands(xpNeeded)} XP`,
        tiles: [
            { label: t('Cash'), value: money(guild.id, account.wallet || 0) },
            { label: t('Bank'), value: money(guild.id, account.bank || 0) },
            { label: t("Club'o'mony cards"), value: `${cardsCollected(account)}/${CARDS.length}` },
            { label: t('Fish species'), value: `${fishCollected(account)}/${FISH.length}` },
        ],
        badgesTitle: t`Badges ${unlocked.length}/${ACHIEVEMENTS.length}`,
        badges: unlocked.slice(0, BADGES_ON_CARD).map((achievement) => tr(achievement.name)),
        badgeEmoji: unlocked.slice(0, 12).map((achievement) => achievement.emoji).join(' '),
        noBadges: t('No badges yet - see /osiagniecia'),
    };
}

function profileButtons(userId) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`profil:odznaki:${userId}`).setLabel(t('Badges')).setEmoji('🏅').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`profil:misje:${userId}`).setLabel(t('Missions')).setEmoji('🎯').setStyle(ButtonStyle.Secondary),
    )];
}

/** The embed used when the picture cannot be drawn. */
function fallbackEmbed(data) {
    return createEmbed({
        title: data.name,
        description: `${data.subtitle}\n${data.xpText}`,
        color: data.accent,
        footer: false,
    })
        .setThumbnail(data.avatarUrl ?? null)
        .addFields(
            ...data.tiles.map((tile) => ({ name: tile.label, value: tile.value, inline: true })),
            { name: data.badgesTitle, value: data.badgeEmoji || data.noBadges },
        );
}

export async function buildProfileReply({ client, guild, user, member }) {
    const data = await profileData({ client, guild, user, member });
    const png = await renderProfileCard(data);
    if (!png) return { embeds: [fallbackEmbed(data)], components: profileButtons(user.id) };
    return { files: [new AttachmentBuilder(png, { name: 'profil.png' })], components: profileButtons(user.id) };
}

export default {
    data: new SlashCommandBuilder()
        .setName('profil')
        .setDescription('Your profile card: level, money, collections and badges')
        .addUserOption(option =>
            option
                .setName('osoba')
                .setDescription('Show the profile of another member')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const user = interaction.options.getUser('osoba') ?? interaction.user;
        if (user.bot) {
            throw createError('Bot has no profile', ErrorTypes.VALIDATION, t("Bots don't have a profile."), { expected: true });
        }
        const member = interaction.guild.members.cache.get(user.id) ?? await interaction.guild.members.fetch?.(user.id).catch(() => null) ?? null;
        await InteractionHelper.safeEditReply(interaction, await buildProfileReply({ client, guild: interaction.guild, user, member }));
    }, { command: 'profil' })
};
