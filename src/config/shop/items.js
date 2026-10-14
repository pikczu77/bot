import { t } from '../../i18n/index.js';

// Shop items. `type`:
//   tool       — kept forever, bought once (bank_note: many times). Shown as "Items" in /sklep.
//   consumable — used up by the command it helps; at most `maxQuantity` uses in the inventory
//   role       — a Discord role
// Tools of one `chain` are tiers: each needs the one before it (`requires`), and only the
// best tier a member owns counts. `bonusPercent` is what that tier adds to the chain's command.
// `priceFrom` ties a default price to the server's payouts (economySettings.js payoutPrice),
// so a consumable bought for one command can earn or lose money.
// Prices balanced on 2026-10-14 for payouts like /mine 300-800 and /fish 200-400.
// Permanent levelled upgrades live in src/services/economyUpgrades.js (/ulepszenia).
export const shopItems = [
    {
        id: 'fishing_rod',
        emoji: '🎣',
        name: t('🎣 Fishing Rod'),
        price: 1500,
        description: t('Needed for `/fish`.'),
        type: 'tool',
        chain: 'fish',
        bonusPercent: 0,
    },
    {
        id: 'carbon_rod',
        emoji: '🎣',
        name: t('Carbon Rod'),
        price: 12000,
        description: t('Works as a fishing rod. +50% on `/fish`.'),
        type: 'tool',
        chain: 'fish',
        bonusPercent: 50,
        requires: 'fishing_rod',
    },
    {
        id: 'golden_rod',
        emoji: '🪝',
        name: t('Golden Rod'),
        price: 35000,
        description: t('Works as a fishing rod. +100% on `/fish`.'),
        type: 'tool',
        chain: 'fish',
        bonusPercent: 100,
        requires: 'carbon_rod',
    },
    {
        id: 'pickaxe',
        emoji: '⛏️',
        name: t('⛏️ Pickaxe'),
        price: 2500,
        description: t('Needed for `/mine`.'),
        type: 'tool',
        chain: 'mine',
        bonusPercent: 0,
    },
    {
        id: 'steel_pickaxe',
        emoji: '⚒️',
        name: t('Steel Pickaxe'),
        price: 18000,
        description: t('Works as a pickaxe. +50% on `/mine`.'),
        type: 'tool',
        chain: 'mine',
        bonusPercent: 50,
        requires: 'pickaxe',
    },
    {
        id: 'diamond_pickaxe',
        emoji: '💎',
        name: t('Diamond Pickaxe'),
        price: 50000,
        description: t('Works as a pickaxe. +100% on `/mine`.'),
        type: 'tool',
        chain: 'mine',
        bonusPercent: 100,
        requires: 'steel_pickaxe',
    },
    {
        id: 'laptop',
        emoji: '💻',
        name: t('💻 Laptop'),
        price: 8000,
        description: t('+50% on `/work`.'),
        type: 'tool',
        chain: 'work',
        bonusPercent: 50,
    },
    {
        id: 'computer',
        emoji: '🖥️',
        name: t('Gaming Computer'),
        price: 25000,
        description: t('+100% on `/work`.'),
        type: 'tool',
        chain: 'work',
        bonusPercent: 100,
        requires: 'laptop',
    },
    {
        id: 'golden_clover',
        emoji: '🍀',
        name: t('Golden Clover'),
        price: 20000,
        description: t('For good: your win chance in every game is 10% higher.'),
        type: 'tool',
        chain: 'luck',
        bonusPercent: 10,
    },
    {
        id: 'diamond_clover',
        emoji: '💠',
        name: t('Diamond Clover'),
        price: 50000,
        description: t('For good: your win chance in every game is 15% higher.'),
        type: 'tool',
        chain: 'luck',
        bonusPercent: 15,
        requires: 'golden_clover',
    },
    {
        id: 'bank_note',
        emoji: '📜',
        name: t('📜 Bank Note'),
        price: 15000,
        description: t('Increases bank capacity by 10,000. Can be purchased multiple times.'),
        type: 'tool',
        stackable: true,
        effect: { type: 'bank_capacity', increase: 10000 }
    },
    {
        id: 'extra_work',
        emoji: '⏱️',
        name: t('Extra Work Shift'),
        price: 100,
        description: t('Allows 1 extra use of the `/work` command.'),
        type: 'consumable',
        maxQuantity: 5,
    },
    {
        id: 'energy_drink',
        emoji: '🥤',
        name: t('Energy Drink'),
        price: 500,
        priceFrom: { commands: ['mine'], factor: 0.9 },
        description: t('Skips the break of `/mine` or `/fish` once.'),
        type: 'consumable',
        maxQuantity: 5,
    },
    {
        id: 'dynamite',
        emoji: '🧨',
        name: t('Dynamite'),
        price: 550,
        priceFrom: { commands: ['mine'], factor: 1 },
        description: t('Your next `/mine` pays double.'),
        type: 'consumable',
        maxQuantity: 5,
    },
    {
        id: 'fishing_net',
        emoji: '🕸️',
        name: t('Fishing Net'),
        price: 300,
        priceFrom: { commands: ['fish'], factor: 1 },
        description: t('Your next `/fish` pays double.'),
        type: 'consumable',
        maxQuantity: 5,
    },
    {
        id: 'balaclava',
        emoji: '🥷',
        name: t('Balaclava'),
        price: 1500,
        description: t('+15% success chance on your next `/crime`.'),
        type: 'consumable',
        maxQuantity: 5,
    },
    {
        id: 'lockpick',
        emoji: '🗝️',
        name: t('Lockpick'),
        price: 1500,
        description: t('+20% success chance on your next `/rob`.'),
        type: 'consumable',
        maxQuantity: 5,
    },
    {
        id: 'insurance',
        emoji: '📋',
        name: t('Insurance'),
        price: 2000,
        description: t('Pays the fine for you once when `/crime` or `/rob` fails.'),
        type: 'consumable',
        maxQuantity: 3,
    },
    {
        id: 'personal_safe',
        emoji: '🔒',
        name: t('🔒 Personal Safe'),
        price: 15000,
        description: t('Stops one robbery against you, then breaks.'),
        type: 'consumable',
        maxQuantity: 3,
    },
    {
        id: 'lucky_clover',
        emoji: '🍀',
        name: t('Lucky Clover'),
        price: 2000,
        description: t('Your next game (/gamble, /ruletka, /slots, /blackjack): win chance 10% higher.'),
        type: 'consumable',
        maxQuantity: 10,
        luckPercent: 10,
    },
    {
        id: 'lucky_charm',
        emoji: '🧿',
        name: t('🍀 Lucky Charm'),
        price: 2500,
        description: t('Your next 3 games: win chance 5% higher.'),
        type: 'consumable',
        maxQuantity: 15,
        uses: 3,
        luckPercent: 5,
    },
    {
        id: 'premium_role',
        emoji: '👑',
        name: t('Premium Server Role'),
        price: 15000,
        description: t('A special role granting a fancy color and a 10% daily bonus.'),
        type: 'role',
        roleId: null,
        effect: { type: 'daily_bonus', multiplier: 1.1 }
    },
];

/** Tier lines of the "Items" folder: the tools of each chain, cheapest first. */
export const ITEM_CHAINS = [
    { id: 'fish', emoji: '🎣', name: t('Fishing rod'), command: 'fish' },
    { id: 'mine', emoji: '⛏️', name: t('Pickaxe'), command: 'mine' },
    { id: 'work', emoji: '🖥️', name: t('Computer'), command: 'work' },
    { id: 'luck', emoji: '🍀', name: t('Clover'), command: null },
].map((chain) => ({ ...chain, items: shopItems.filter((item) => item.chain === chain.id) }));

export function getItemById(itemId) {
    return shopItems.find(item => item.id === itemId);
}

export function getItemsByType(type) {
    return shopItems.filter(item => item.type === type);
}

export function getItemPrice(itemId) {
    const item = getItemById(itemId);
    return item ? item.price : 0;
}

export const getChain = (chainId) => ITEM_CHAINS.find((chain) => chain.id === chainId) ?? null;

const owns = (userData, itemId) => (userData?.inventory?.[itemId] || 0) > 0;
// Position of an item in its chain, by id: shop entries are copies with the server's price.
const tierOf = (chain, itemId) => chain.items.findIndex((entry) => entry.id === itemId);

/** The best tier of `chainId` the member owns, or null. */
export function bestInChain(userData, chainId) {
    const chain = getChain(chainId);
    if (!chain) return null;
    for (let index = chain.items.length - 1; index >= 0; index -= 1) {
        if (owns(userData, chain.items[index].id)) return chain.items[index];
    }
    return null;
}

/** Percent the member's best tool adds to `chainId` (0 without one). */
export const chainBonusPercent = (userData, chainId) => bestInChain(userData, chainId)?.bonusPercent ?? 0;

/** The next tier of `chainId` the member can buy, or null when they own the best one. */
export function nextInChain(userData, chainId) {
    const chain = getChain(chainId);
    if (!chain) return null;
    const best = bestInChain(userData, chainId);
    return chain.items[best ? chain.items.indexOf(best) + 1 : 0] ?? null;
}

/** How many more of `item` this member may buy right now (Infinity = no limit). */
export function purchaseRoom(item, userData) {
    const owned = userData?.inventory?.[item.id] || 0;
    if (item.type === 'consumable' && item.maxQuantity) {
        return Math.max(0, Math.floor((item.maxQuantity - owned) / (item.uses || 1)));
    }
    if (item.type === 'tool' && item.chain) {
        const best = bestInChain(userData, item.chain);
        const chain = getChain(item.chain);
        return best && tierOf(chain, best.id) >= tierOf(chain, item.id) ? 0 : 1;
    }
    if (item.type === 'tool' && !item.stackable) return owned > 0 ? 0 : 1;
    if (item.type === 'role') return 1;
    return Infinity;
}

/** The tier that must be owned before `item` can be bought, when the member lacks it. */
export function missingRequirement(item, userData) {
    if (!item.requires) return null;
    const needed = getItemById(item.requires);
    if (!needed) return null;
    const chain = getChain(item.chain);
    const best = chain ? bestInChain(userData, item.chain) : null;
    if (best && tierOf(chain, best.id) >= tierOf(chain, needed.id)) return null;
    return owns(userData, needed.id) ? null : needed;
}

export function validatePurchase(itemId, userData) {
    const item = getItemById(itemId);
    if (!item) {
        return { valid: false, reason: t('Item not found') };
    }
    if (purchaseRoom(item, userData) <= 0) {
        return { valid: false, reason: t`You already have as many ${item.name} as you can.` };
    }
    return { valid: true };
}
