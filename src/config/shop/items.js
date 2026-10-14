import { t } from '../../i18n/index.js';

// Shop items. `type`:
//   tool       — kept forever, bought once (bank_note: many times)
//   consumable — used up by the command it helps; at most `maxQuantity` in the inventory
//   role       — a Discord role
// Permanent levelled upgrades live in src/services/economyUpgrades.js (/ulepszenia).
export const shopItems = [
    {
        id: 'laptop',
        emoji: '💻',
        name: t('💻 Laptop'),
        price: 15000,
        description: t('Increases work earnings'),
        type: 'tool',
        effect: { type: 'work_yield', multiplier: 1.5 }
    },
    {
        id: 'pickaxe',
        emoji: '⛏️',
        name: t('⛏️ Pickaxe'),
        price: 3000,
        description: t('Needed for `/mine`.'),
        type: 'tool',
        effect: { type: 'mining_tool', multiplier: 1.0 }
    },
    {
        id: 'diamond_pickaxe',
        emoji: '💎',
        name: t('Diamond Pickaxe'),
        price: 50000,
        description: t('Works as a pickaxe and doubles what you earn with `/mine`.'),
        type: 'tool',
        effect: { type: 'mining_yield', multiplier: 2.0 }
    },
    {
        id: 'fishing_rod',
        emoji: '🎣',
        name: t('🎣 Fishing Rod'),
        price: 2000,
        description: t('Needed for `/fish`.'),
        type: 'tool',
        effect: { type: 'fishing_tool', multiplier: 1.0 }
    },
    {
        id: 'golden_rod',
        emoji: '🪝',
        name: t('Golden Rod'),
        price: 40000,
        description: t('Works as a fishing rod and doubles what you earn with `/fish`.'),
        type: 'tool',
        effect: { type: 'fishing_yield', multiplier: 2.0 }
    },
    {
        id: 'bank_note',
        emoji: '📜',
        name: t('📜 Bank Note'),
        price: 25000,
        description: t('Increases bank capacity by 10,000. Can be purchased multiple times.'),
        type: 'tool',
        stackable: true,
        effect: { type: 'bank_capacity', increase: 10000 }
    },
    {
        id: 'extra_work',
        emoji: '⏱️',
        name: t('Extra Work Shift'),
        price: 5000,
        description: t('Allows 1 extra use of the `/work` command.'),
        type: 'consumable',
        maxQuantity: 5,
        effect: { type: 'command_boost', command: 'work', uses: 1 }
    },
    {
        id: 'energy_drink',
        emoji: '🥤',
        name: t('Energy Drink'),
        price: 4000,
        description: t('Skips the break of `/mine` or `/fish` once.'),
        type: 'consumable',
        maxQuantity: 5,
        effect: { type: 'command_boost', command: ['mine', 'fish'], uses: 1 }
    },
    {
        id: 'lockpick',
        emoji: '🗝️',
        name: t('Lockpick'),
        price: 3000,
        description: t('+20% success chance on your next `/rob`.'),
        type: 'consumable',
        maxQuantity: 5,
        effect: { type: 'rob_boost', percent: 20, uses: 1 }
    },
    {
        id: 'insurance',
        emoji: '📋',
        name: t('Insurance'),
        price: 6000,
        description: t('Pays the fine for you once when `/crime` or `/rob` fails.'),
        type: 'consumable',
        maxQuantity: 3,
        effect: { type: 'fine_cover', uses: 1 }
    },
    {
        id: 'personal_safe',
        emoji: '🔒',
        name: t('🔒 Personal Safe'),
        price: 30000,
        description: t('Stops one robbery against you, then breaks.'),
        type: 'consumable',
        maxQuantity: 3,
        effect: { type: 'robbery_protection', uses: 1 }
    },
    {
        id: 'lucky_clover',
        emoji: '🍀',
        name: t('Lucky Clover'),
        price: 10000,
        description: t('Increases the chance of winning a higher payout on `/gamble` once.'),
        type: 'consumable',
        maxQuantity: 10,
        effect: { type: 'gamble_boost', multiplier: 1.5, uses: 1 }
    },
    {
        id: 'lucky_charm',
        emoji: '🧿',
        name: t('🍀 Lucky Charm'),
        price: 10000,
        description: t('Increases luck for gambling. Has 3 uses before being consumed.'),
        type: 'consumable',
        maxQuantity: 10,
        effect: { type: 'gamble_boost', multiplier: 1.3, uses: 3 }
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

/** How many more of `item` this member may buy right now (Infinity = no limit). */
export function purchaseRoom(item, userData) {
    const owned = userData?.inventory?.[item.id] || 0;
    if (item.type === 'consumable' && item.maxQuantity) return Math.max(0, item.maxQuantity - owned);
    if (item.type === 'tool' && !item.stackable) return owned > 0 ? 0 : 1;
    if (item.type === 'role') return 1;
    return Infinity;
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
