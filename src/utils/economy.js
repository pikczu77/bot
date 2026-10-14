// economy.js

import { getColor, getEconomyKey as getEconomyStorageKey } from './database.js';
import { BotConfig } from '../config/bot.js';
import { normalizeEconomyData } from './schemas.js';
import { logger } from './logger.js';
import { validateDiscordId, validateNumber } from './validation.js';
import { DEFAULT_ECONOMY_DATA } from './constants.js';
import { createError, ErrorTypes, wrapServiceBoundary } from './errorHandler.js';
import { getEconomySettings, scaleEarnings } from '../services/economySettings.js';
import { extraBankCapacity } from '../services/economyUpgrades.js';
import { getSpouseId, pairKey } from '../services/marriageService.js';
import { Mutex } from './mutex.js';
import { t } from '../i18n/index.js';

const ECONOMY_CONFIG = BotConfig.economy || {};
const BASE_BANK_CAPACITY = ECONOMY_CONFIG.baseBankCapacity || 10000;
const BANK_CAPACITY_PER_LEVEL = ECONOMY_CONFIG.bankCapacityPerLevel || 5000;
const DAILY_AMOUNT = ECONOMY_CONFIG.dailyAmount || 100;
const WORK_MIN = ECONOMY_CONFIG.workMin || 10;
const WORK_MAX = ECONOMY_CONFIG.workMax || 100;
const COOLDOWNS = ECONOMY_CONFIG.cooldowns || {
daily: 24 * 60 * 60 * 1000,
work: 60 * 60 * 1000,
crime: 2 * 60 * 60 * 1000,
rob: 4 * 60 * 60 * 1000,
};

export function getEconomyKey(guildId, userId) {
    const validGuildId = validateDiscordId(guildId, 'guildId');
    const validUserId = validateDiscordId(userId, 'userId');
    
    if (!validGuildId || !validUserId) {
        throw new Error(t('Invalid guild ID or user ID'));
    }
    
    return getEconomyStorageKey(validGuildId, validUserId);
}

export function getMaxBankCapacity(userData) {
    if (!userData) return BASE_BANK_CAPACITY;
    
    const bankLevel = userData.bankLevel || 0;
    let capacity = BASE_BANK_CAPACITY + (bankLevel * BANK_CAPACITY_PER_LEVEL);

    const upgrades = userData.upgrades || {};
    const inventory = userData.inventory || {};

    if (upgrades['bank_upgrade_1']) {
        capacity = Math.floor(capacity * 1.5);
    }

    const bankNotes = inventory['bank_note'] || 0;
    capacity += (bankNotes * 10000);
    capacity += extraBankCapacity(userData);

    // Married: the joint bank holds what both accounts can hold.
    capacity += userData._joint?.partnerCapacity || 0;

    return capacity;
}

/** The member's own account, without the spouse's part of a joint bank. */
export function ownBank(userData) {
    return userData?._joint?.ownBank ?? (userData?.bank || 0);
}

export function formatCurrency(amount) {
    const currencyName = ECONOMY_CONFIG.currency?.name || 'coins';
    return `${amount.toLocaleString()} ${currencyName}`;
}

async function readEconomyRecord(client, guildId, userId) {
    const key = getEconomyKey(guildId, userId);
    const data = await client.db.get(key, {});
    const settings = await getEconomySettings(guildId);
    const defaults = {
        ...DEFAULT_ECONOMY_DATA,
        wallet: settings.startingWallet,
        bank: settings.startingBank,
    };
    const record = normalizeEconomyData(data, defaults);
    delete record._joint;
    return record;
}

async function spouseOf(guildId, userId) {
    try {
        return await getSpouseId(guildId, userId);
    } catch (error) {
        logger.error(`Could not read the marriage of user ${userId}`, error);
        return null;
    }
}

/**
 * Economy data of a member. For a married member `bank` is the joint bank (own account +
 * spouse's account) and `_joint` = { partnerId, ownBank, partnerBank, partnerCapacity }
 * says how it splits; setEconomyData() spreads a change of `bank` back over both accounts.
 * Pass `{ joint: false }` for the member's own account only (the web panel does).
 */
export async function getEconomyData(client, guildId, userId, { joint = true } = {}) {
    try {
        if (!client.db || typeof client.db.get !== 'function') {
            throw new Error(t('Database not available'));
        }

        const data = await readEconomyRecord(client, guildId, userId);
        const partnerId = joint ? await spouseOf(guildId, userId) : null;
        if (!partnerId) return data;

        const partner = await readEconomyRecord(client, guildId, partnerId);
        data._joint = {
            partnerId,
            ownBank: data.bank || 0,
            partnerBank: partner.bank || 0,
            partnerCapacity: getMaxBankCapacity(partner),
        };
        data.bank = data._joint.ownBank + data._joint.partnerBank;
        return data;
    } catch (error) {
        logger.error(`Error getting economy data for user ${userId}`, error);
        return normalizeEconomyData({}, DEFAULT_ECONOMY_DATA);
    }
}

/**
 * Save the data of a married member: the change of the joint `bank` since it was read goes
 * to the accounts. Money in fills the own account first (up to its capacity), then the
 * spouse's; money out comes from the own account first, then from the spouse's. Both
 * accounts are read again here, so changes the spouse made in the meantime are kept.
 */
async function saveJointEconomyData(client, guildId, userId, plain, joint, original) {
    const ownKey = getEconomyKey(guildId, userId);
    const partnerKey = getEconomyKey(guildId, joint.partnerId);
    const stillMarried = (await spouseOf(guildId, userId)) === joint.partnerId;

    const storedOwn = await client.db.get(ownKey, null);
    let own = storedOwn && typeof storedOwn === 'object' ? Math.max(0, Number(storedOwn.bank) || 0) : joint.ownBank;
    const partnerRecord = await readEconomyRecord(client, guildId, joint.partnerId);
    let partner = partnerRecord.bank || 0;
    const partnerBefore = partner;

    let change = Math.max(0, plain.bank || 0) - (joint.ownBank + joint.partnerBank);
    if (change > 0) {
        const toOwn = Math.min(change, Math.max(0, getMaxBankCapacity(plain) - own));
        own += toOwn;
        change -= toOwn;
        if (stillMarried) {
            const toPartner = Math.min(change, Math.max(0, getMaxBankCapacity(partnerRecord) - partner));
            partner += toPartner;
            change -= toPartner;
        }
        own += change;
    } else if (change < 0) {
        let missing = -change;
        const fromOwn = Math.min(own, missing);
        own -= fromOwn;
        missing -= fromOwn;
        if (stillMarried) partner -= Math.min(partner, missing);
    }

    if (partner !== partnerBefore) {
        await client.db.set(partnerKey, normalizeEconomyData({ ...partnerRecord, bank: partner }, DEFAULT_ECONOMY_DATA));
    }
    await client.db.set(ownKey, normalizeEconomyData({ ...plain, bank: own }, DEFAULT_ECONOMY_DATA));

    // A second save of the same object must not apply the change again.
    joint.ownBank = own;
    joint.partnerBank = stillMarried ? partner : 0;
    if (original && typeof original === 'object') original.bank = joint.ownBank + joint.partnerBank;
}

/**
 * Divorce: the two bank accounts are added up and split in half (the odd coin goes to
 * `secondId`). Call it after the marriage was removed. Returns { first, second } = new balances.
 */
export async function splitJointBank(client, guildId, firstId, secondId) {
    return Mutex.runExclusive(`joint-bank:${guildId}:${pairKey(firstId, secondId)}`, async () => {
        const first = await readEconomyRecord(client, guildId, firstId);
        const second = await readEconomyRecord(client, guildId, secondId);
        const total = (first.bank || 0) + (second.bank || 0);
        const half = Math.floor(total / 2);
        await client.db.set(getEconomyKey(guildId, firstId), normalizeEconomyData({ ...first, bank: half }, DEFAULT_ECONOMY_DATA));
        await client.db.set(getEconomyKey(guildId, secondId), normalizeEconomyData({ ...second, bank: total - half }, DEFAULT_ECONOMY_DATA));
        return { first: half, second: total - half };
    });
}

export async function setEconomyData(client, guildId, userId, data) {
    try {
        if (!client.db || typeof client.db.set !== 'function') {
            throw new Error(t('Database not available'));
        }

        const key = getEconomyKey(guildId, userId);
        const { _joint: joint, ...plain } = data ?? {};
        if (joint?.partnerId) {
            await Mutex.runExclusive(`joint-bank:${guildId}:${pairKey(userId, joint.partnerId)}`, () =>
                saveJointEconomyData(client, guildId, userId, plain, joint, data));
            return true;
        }

        const normalized = normalizeEconomyData(plain, DEFAULT_ECONOMY_DATA);
        await client.db.set(key, normalized);
        return true;
    } catch (error) {
        logger.error(`Error saving economy data for user ${userId}`, error);
        return false;
    }
}

const lastActivityReward = new Map(); // `${guildId}:${userId}` -> timestamp
const ACTIVITY_MAP_LIMIT = 20000;

/** Money for chatting (economy settings: activity). Returns the amount paid, 0 when none. */
export async function payActivityReward(client, guildId, userId) {
    const settings = await getEconomySettings(guildId);
    const { activity } = settings;
    const amount = scaleEarnings(settings, activity.amount);
    if (!activity.enabled || amount <= 0) return 0;

    const key = `${guildId}:${userId}`;
    const now = Date.now();
    if (now - (lastActivityReward.get(key) ?? 0) < activity.cooldownSeconds * 1000) return 0;
    if (lastActivityReward.size >= ACTIVITY_MAP_LIMIT) lastActivityReward.clear();
    lastActivityReward.set(key, now);

    const data = await getEconomyData(client, guildId, userId);
    data.wallet = (data.wallet || 0) + amount;
    await setEconomyData(client, guildId, userId, data);
    return amount;
}

export async function updateBalance(client, guildId, userId, options = {}) {
    const data = await getEconomyData(client, guildId, userId);
    
    if (options.wallet !== undefined) {
        data.wallet = Math.max(0, (data.wallet || 0) + options.wallet);
    }
    
    if (options.bank !== undefined) {
        const maxBank = getMaxBankCapacity(data);
        data.bank = Math.min(Math.max(0, (data.bank || 0) + options.bank), maxBank);
    }
    
    if (options.xp !== undefined) {
        data.xp = Math.max(0, (data.xp || 0) + options.xp);
        
        const xpNeeded = Math.floor(5 * Math.pow(data.level || 1, 2) + 50 * (data.level || 1) + 100);
        if (data.xp >= xpNeeded) {
            data.xp -= xpNeeded;
            data.level = (data.level || 1) + 1;
            data.leveledUp = true;
        }
    }
    
    await setEconomyData(client, guildId, userId, data);
    return data;
}

export function checkCooldown(userData, action) {
    const cooldownTime = COOLDOWNS[action] || 0;
    const lastUsed = userData[`last${action.charAt(0).toUpperCase() + action.slice(1)}`] || 0;
    const now = Date.now();
    const remaining = Math.max(0, (lastUsed + cooldownTime) - now);
    
    return {
        onCooldown: remaining > 0,
        remaining,
        formatted: formatCooldown(remaining)
    };
}

function formatCooldown(ms) {
    if (ms < 1000) return 'now';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

export function getWorkReward() {
    const amount = Math.floor(Math.random() * (WORK_MAX - WORK_MIN + 1)) + WORK_MIN;
    const jobs = [
        t('worked at a fast food restaurant'),
        t('worked as a programmer'),
        t('worked as a construction worker'),
        t('worked as a doctor'),
        t('worked as a streamer'),
        t('worked as a YouTuber'),
        t('worked as a teacher'),
        t('worked as a cashier'),
        t('worked as a delivery driver'),
        t('worked as a freelancer')
    ];
    
    const job = jobs[Math.floor(Math.random() * jobs.length)];
    
    return {
        amount,
        job,
        message: t`You ${job} and earned ${formatCurrency(amount)}!`
    };
}

export function getCrimeOutcome() {
    const outcomes = [
        {
            success: true,
            amount: Math.floor(Math.random() * 200) + 50,
            message: t('You successfully robbed a bank and got away with {amount}!') 
        },
        {
            success: true,
            amount: Math.floor(Math.random() * 100) + 20,
            message: t('You pickpocketed someone and stole {amount}!') 
        },
        {
            success: true,
            amount: Math.floor(Math.random() * 150) + 30,
            message: t('You hacked into a bank account and transferred {amount} to yourself!') 
        },
        {
            success: false,
            fine: Math.floor(Math.random() * 100) + 50,
            message: t('You got caught and had to pay a fine of {fine}!') 
        },
        {
            success: false,
            fine: Math.floor(Math.random() * 150) + 50,
            message: t('The police caught you! You paid {fine} to get out of jail.') 
        },
        {
            success: false,
            fine: 0,
            message: t('Your attempt failed, but you managed to escape!') 
        }
    ];
    
    return outcomes[Math.floor(Math.random() * outcomes.length)];
}

export function getRobOutcome(targetBalance) {
    if (targetBalance <= 0) {
        return {
            success: false,
            amount: 0,
            message: t('The target has no money to steal!')
        };
    }
    
const success = Math.random() > 0.4;
    
    if (success) {
        const amount = Math.min(
Math.floor(Math.random() * (targetBalance * 0.3)) + 1,
            targetBalance
        );
        
        return {
            success: true,
            amount,
            message: t`You successfully robbed them and got away with {amount}!`
        };
    } else {
        const fine = Math.floor(Math.random() * 200) + 100;
        
        return {
            success: false,
            amount: 0,
            fine,
            message: t`You got caught! You had to pay a fine of {fine}.`
        };
    }
}

export function formatShopItem(item, index) {
    return `**${index + 1}.** ${item.emoji} **${item.name}** - ${formatCurrency(item.price)}\n${item.description}\n`;
}

export const addMoney = wrapServiceBoundary(async function addMoney(client, guildId, userId, amount, type = 'wallet') {
    const validAmount = validateNumber(amount, 'amount');
    if (validAmount === null || validAmount <= 0) {
        throw createError(
            'Invalid amount',
            ErrorTypes.VALIDATION,
            t('Amount must be a positive number.'),
            { guildId, userId, amount, operation: 'addMoney' }
        );
    }

    if (type !== 'wallet' && type !== 'bank') {
        throw createError(
            'Invalid money type',
            ErrorTypes.VALIDATION,
            t('Type must be "wallet" or "bank".'),
            { guildId, userId, type, operation: 'addMoney' }
        );
    }

    const userData = await getEconomyData(client, guildId, userId);

    if (type === 'bank') {
        const maxBank = getMaxBankCapacity(userData);
        if ((userData.bank || 0) + validAmount > maxBank) {
            throw createError(
                'Bank capacity exceeded',
                ErrorTypes.VALIDATION,
                t`Bank capacity exceeded. Current: ${userData.bank || 0}, Max: ${maxBank}.`,
                { guildId, userId, current: userData.bank || 0, max: maxBank, operation: 'addMoney' }
            );
        }
        userData.bank = (userData.bank || 0) + validAmount;
    } else {
        userData.wallet = (userData.wallet || 0) + validAmount;
    }

    await setEconomyData(client, guildId, userId, userData);

    return {
        newBalance: type === 'bank' ? userData.bank : userData.wallet,
        ...(type === 'bank' ? { maxBank: getMaxBankCapacity(userData) } : {}),
    };
}, {
    service: 'economy',
    operation: 'addMoney',
    userMessage: t('Failed to add money. Please try again.'),
});

export const removeMoney = wrapServiceBoundary(async function removeMoney(client, guildId, userId, amount, type = 'wallet') {
    const validAmount = validateNumber(amount, 'amount');
    if (validAmount === null || validAmount <= 0) {
        throw createError(
            'Invalid amount',
            ErrorTypes.VALIDATION,
            t('Amount must be a positive number.'),
            { guildId, userId, amount, operation: 'removeMoney' }
        );
    }

    if (type !== 'wallet' && type !== 'bank') {
        throw createError(
            'Invalid money type',
            ErrorTypes.VALIDATION,
            t('Type must be "wallet" or "bank".'),
            { guildId, userId, type, operation: 'removeMoney' }
        );
    }

    const userData = await getEconomyData(client, guildId, userId);

    if (type === 'bank') {
        if ((userData.bank || 0) < validAmount) {
            throw createError(
                'Insufficient bank funds',
                ErrorTypes.VALIDATION,
                t`Insufficient funds in bank. You have ${userData.bank || 0}, need ${validAmount}.`,
                { guildId, userId, current: userData.bank || 0, required: validAmount, operation: 'removeMoney' }
            );
        }
        userData.bank = (userData.bank || 0) - validAmount;
    } else {
        if ((userData.wallet || 0) < validAmount) {
            throw createError(
                'Insufficient wallet funds',
                ErrorTypes.VALIDATION,
                t`Insufficient funds in wallet. You have ${userData.wallet || 0}, need ${validAmount}.`,
                { guildId, userId, current: userData.wallet || 0, required: validAmount, operation: 'removeMoney' }
            );
        }
        userData.wallet = (userData.wallet || 0) - validAmount;
    }

    await setEconomyData(client, guildId, userId, userData);

    return {
        newBalance: type === 'bank' ? userData.bank : userData.wallet,
    };
}, {
    service: 'economy',
    operation: 'removeMoney',
    userMessage: t('Failed to remove money. Please try again.'),
});

export function getShopInventory() {
    return [
        {
            id: 'fishing_rod',
            name: t('Fishing Rod'),
            emoji: '🎣',
            price: 500,
            description: t('Catch fish to sell for profit!'),
            type: 'tool'
        },
        {
            id: 'hunting_rifle',
            name: t('Hunting Rifle'),
            emoji: '🔫',
            price: 1000,
            description: t('Hunt animals for meat and fur!'),
            type: 'tool'
        },
        {
            id: 'laptop',
            name: t('Laptop'),
            emoji: '💻',
            price: 2000,
            description: t('Work as a programmer for higher pay!'),
            type: 'tool',
            workMultiplier: 1.5
        },
        {
            id: 'bank_loan',
            name: t('Bank Loan'),
            emoji: '🏦',
            price: 5000,
            description: t('Increases your bank capacity by 50,000!'),
            type: 'upgrade',
            effect: 'bank_capacity',
            value: 50000
        },
        {
            id: 'lottery_ticket',
            name: t('Lottery Ticket'),
            emoji: '🎫',
            price: 100,
            description: t('A chance to win big!'),
            type: 'consumable',
            use: 'gamble'
        }
    ];
}