import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import {
    HALLOWEEN_SHOP, SHOP_GRACE_MS, buyHalloweenItem, candiesOf, candyRanking, getHalloween, halloweenActive, shopOpen,
} from '../../services/halloween.js';
import { progressEmbeds } from '../../services/progress.js';
import { t } from '../../i18n/index.js';

// /halloween sklep | kup | ranking — the Halloween 2026 event (2026-10-29). Rules: services/halloween.js.

const COLOR = '#FF7518';
const ts = (ms, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

async function shopEmbed(client, guildId, user, notice = '') {
    const settings = await getHalloween(guildId);
    const economy = await getEconomySettings(guildId);
    const { candies, earned } = candiesOf(await getEconomyData(client, guildId, user.id, { joint: false }));
    const now = Date.now();
    const status = halloweenActive(settings, now)
        ? t`🎃 The event runs until ${ts(settings.endsAt)}. Every message gives **${settings.perMessage} 🍬** (once every ${settings.cooldownSeconds} s).`
        : shopOpen(settings, now)
            ? t`🎃 The event is over; the shop is open until ${ts(settings.endsAt + SHOP_GRACE_MS)}.`
            : t('🎃 The Halloween shop is closed.');
    return createEmbed({
        title: t('🎃 Halloween shop'),
        description: [
            notice,
            status,
            t`**Your candies:** ${candies} 🍬 (collected ${earned})`,
            '',
            ...HALLOWEEN_SHOP.map((item) => `${item.emoji} **${item.name}** · ${item.price} 🍬`
                + (item.cash ? ` (${money(guildId, scaleEarnings(economy, item.cash))})` : '')),
            '',
            t('-# Buy with `/halloween kup`. Boosts also: `/boosty`.'),
        ].filter((line) => line !== null).join('\n'),
        color: COLOR,
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('halloween')
        .setDescription('Halloween event: candies for chatting and the Halloween shop')
        .addSubcommand((sub) => sub
            .setName('sklep')
            .setDescription('Your candies and what they buy'))
        .addSubcommand((sub) => sub
            .setName('kup')
            .setDescription('Buy something with candies')
            .addStringOption((option) => option.setName('przedmiot').setDescription('What').setRequired(true)
                .addChoices(...HALLOWEEN_SHOP.map((item) => ({ name: `${item.emoji} ${item.name} (${item.price})`, value: item.id })))))
        .addSubcommand((sub) => sub
            .setName('ranking')
            .setDescription('Who collected the most candies')),

    execute: withErrorHandling(async (interaction, config, client) => {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        if (sub === 'kup') {
            const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
            const { item, note, progress } = await buyHalloweenItem({
                client, guild: interaction.guild, member, itemId: interaction.options.getString('przedmiot'), userError,
            });
            const notice = t`✅ You bought ${item.emoji} **${item.name}** for ${item.price} 🍬. ${note}`;
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [await shopEmbed(client, guildId, interaction.user, notice), ...progressEmbeds(progress, guildId)],
                allowedMentions: { parse: [] },
            });
        }
        if (sub === 'ranking') {
            const top = await candyRanking(guildId, 10);
            const medals = ['🥇', '🥈', '🥉'];
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: t('🎃 Candy ranking'),
                    description: top.length
                        ? top.map((row, index) => `${medals[index] ?? `**${index + 1}.**`} <@${row.userId}> · **${row.earned} 🍬**`).join('\n')
                        : t('Nobody has candies yet. Write on the server!'),
                    color: COLOR,
                    footer: false,
                })],
                allowedMentions: { parse: [] },
            });
        }
        return InteractionHelper.safeEditReply(interaction, { embeds: [await shopEmbed(client, guildId, interaction.user)] });
    }, { command: 'halloween' })
};
