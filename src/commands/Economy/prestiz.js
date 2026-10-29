import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money } from '../../services/economySettings.js';
import { MAX_PRESTIGE, PRESTIGE_PERCENT_PER_LEVEL, nextPrestige, ownMoney, prestigeLevel } from '../../services/prestige.js';
import { t } from '../../i18n/index.js';

// /prestiz [osoba] — start over for a lasting bonus, 10 levels (2026-10-29). Rules: services/prestige.js.
// Buttons (only for the member): prestiz:start:<userId> asks once more, prestiz:tak:<userId> does it,
// prestiz:nie:<userId> cancels (interactions/buttons/economy/prestige.js).

const COLOR = '#FFD60A';
const stars = (level) => '⭐'.repeat(level) + '☆'.repeat(MAX_PRESTIGE - level);

/** The prestige view of a member; `own` adds the button when the next prestige is possible. */
export async function prestigeView(client, guildId, user, { own = true, notice = '' } = {}) {
    await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id, { joint: false });
    const level = prestigeLevel(userData);
    const next = nextPrestige(userData);
    const have = ownMoney(userData);
    const ready = Boolean(next) && have >= next.cost;
    const embed = createEmbed({
        title: t`⭐ Prestige of ${user.username}`,
        description: [
            notice,
            `${stars(level)}  **${level}/${MAX_PRESTIGE}**`,
            t`**Bonus now:** +${level * PRESTIGE_PERCENT_PER_LEVEL}% of every payout`,
            next
                ? t`**Prestige ${next.level}:** ${money(guildId, next.cost)} in cash and bank (you have ${money(guildId, have)}) · then +${next.level * PRESTIGE_PERCENT_PER_LEVEL}%`
                : t('**Highest prestige reached.** 👑'),
            '',
            t('🔄 **Reset:** cash and bank (to the starting amount), upgrades, shares, buildings'),
            t('✅ **Kept:** items, cards, fish, badges, club, marriage, boosts'),
        ].filter((line) => line !== null).join('\n'),
        color: COLOR,
        footer: false,
    });
    const components = own && next ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`prestiz:start:${user.id}`).setLabel(ready ? t`Do prestige ${next.level}` : t('Not enough money yet'))
            .setEmoji('⭐').setStyle(ready ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!ready),
    )] : [];
    return { embeds: [embed], components };
}

/** The second question before the reset. */
export function confirmView(guildId, user, userData) {
    const next = nextPrestige(userData);
    return {
        embeds: [createEmbed({
            title: t`⚠️ Prestige ${next.level}: are you sure?`,
            description: t`You lose **${money(guildId, ownMoney(userData))}**, every upgrade, your shares and buildings. You get **+${next.level * PRESTIGE_PERCENT_PER_LEVEL}%** of every payout for good. This cannot be undone.`,
            color: '#FF453A',
            footer: false,
        })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`prestiz:tak:${user.id}`).setLabel(t('Yes, start over')).setEmoji('⭐').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`prestiz:nie:${user.id}`).setLabel(t('Cancel')).setStyle(ButtonStyle.Secondary),
        )],
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('prestiz')
        .setDescription('Start over for a lasting bonus (10 prestige levels)')
        .addUserOption((option) => option.setName('osoba').setDescription('Whose prestige')),

    execute: withErrorHandling(async (interaction, config, client) => {
        const other = interaction.options.getUser('osoba');
        const own = !other || other.id === interaction.user.id;
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: own ? MessageFlags.Ephemeral : undefined });
        if (!deferred) return;
        const payload = await prestigeView(client, interaction.guildId, other ?? interaction.user, { own });
        return InteractionHelper.safeEditReply(interaction, payload);
    }, { command: 'prestiz' })
};
