// The /ulepszenia message: every permanent upgrade with its level, effect and the price
// of the next level, plus one button per upgrade. The buttons are handled by
// src/interactions/buttons/economy/upgrades.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { money } from '../../../services/economySettings.js';
import { UPGRADES, describeUpgradeEffect, getUpgradeLevel, upgradePrice } from '../../../services/economyUpgrades.js';
import { t, tr } from '../../../i18n/index.js';

const BUTTONS_PER_ROW = 5;

/**
 * @param {object} options
 * @param {string} options.guildId
 * @param {object} options.userData  economy data of the member shown
 * @param {object} options.user      Discord user shown
 * @param {string|null} options.ownerId  who may press the buttons; null = view only
 * @param {string} [options.notice]  line shown above the list (result of the last click)
 */
export function buildUpgradesView({ guildId, userData, user, ownerId = null, notice = '' }) {
    const funds = (userData.wallet || 0) + (userData.bank || 0);

    const fields = UPGRADES.map((upgrade) => {
        const level = getUpgradeLevel(userData, upgrade.id);
        const price = upgradePrice(upgrade, level);
        const lines = [
            `-# ${tr(upgrade.description)}`,
            level > 0 ? t`Now: **${describeUpgradeEffect(upgrade, level, guildId)}**` : t('Now: not bought'),
            price === null
                ? t('✅ Highest level')
                : t`Next: ${describeUpgradeEffect(upgrade, level + 1, guildId)} · **${money(guildId, price)}**`,
        ];
        return {
            name: `${upgrade.emoji} ${tr(upgrade.name)} · ${level}/${upgrade.maxLevel}`,
            value: lines.join('\n'),
            inline: true,
        };
    });

    const embed = createEmbed({
        title: t`⚡ Upgrades · ${user.displayName ?? user.username}`,
        description: [
            notice,
            t('Permanent upgrades: bought once, they stay forever. You pay with cash first, then from the bank.'),
            t`💵 **${money(guildId, userData.wallet || 0)}** · 🏦 **${money(guildId, userData.bank || 0)}**`,
        ].filter(Boolean).join('\n\n'),
        fields,
        thumbnail: user.displayAvatarURL?.() ?? null,
    });

    if (!ownerId) return { embeds: [embed], components: [] };

    const buttons = UPGRADES.map((upgrade) => {
        const level = getUpgradeLevel(userData, upgrade.id);
        const price = upgradePrice(upgrade, level);
        const label = price === null
            ? t`${tr(upgrade.name)} · MAX`
            : t`${tr(upgrade.name)} · ${money(guildId, price)}`;
        return new ButtonBuilder()
            .setCustomId(`ulepszenia:kup:${ownerId}:${upgrade.id}`)
            .setLabel(label.slice(0, 80))
            .setEmoji(upgrade.emoji)
            .setStyle(price !== null && funds >= price ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(price === null || funds < price);
    });

    const components = [];
    for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
        components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
    }
    return { embeds: [embed], components };
}
