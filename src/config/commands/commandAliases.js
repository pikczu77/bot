/**
 * Command Aliases Configuration
 * Maps shortened command names to their full command names
 */

export const commandAliases = {
    'bal': 'balans',
    'balance': 'balans',
    'money': 'hajs',
    'cash': 'hajs',

    'dep': 'deposit',
    'with': 'withdraw',
    'work': 'work',
    'daily': 'daily',
    'gamble': 'gamble',
    'bet': 'gamble',
    'roulette': 'ruletka',
    'bj': 'blackjack',
    'slot': 'slots',
    'rob': 'rob',
    'crime': 'crime',
    'pay': 'pay',
    'give': 'pay',
    'send': 'pay',

    'ping': 'ping',
    'pomoc': 'pomoc',
    'help': 'pomoc',
    'h': 'pomoc',
    'komendy': 'komendy',
    'commands': 'komendy',

    'ban': 'ban',
    'kick': 'kick',
    'mute': 'mute',
    'timeout': 'mute',
    'warn': 'warn',
    'clear': 'purge',
    'purge': 'purge',
    'unmute': 'unmute',
    'untimeout': 'unmute',

    'poziom': 'poziom',
    'rank': 'poziom',
    'lvl': 'poziom',
    'top': 'top',
    'leaderboard': 'top',
    'lb': 'top',
    'topkasa': 'topkasa',
    'eleaderboard': 'topkasa',

    'shop': 'sklep',
    'sklep': 'sklep',
    'ulepszenia': 'ulepszenia',
    'upgrades': 'ulepszenia',
    'buy': 'sklep',
    'kup': 'sklep',
    'ekwipunek': 'ekwipunek',
    'inventory': 'ekwipunek',
    'inv': 'ekwipunek',
    'eq': 'ekwipunek',
    'items': 'ekwipunek',

    'user': 'userinfo',
    'server': 'serverinfo',
    'avatar': 'avatar',
    'pfp': 'avatar',
    'icon': 'avatar',

    'urodziny': 'urodziny',
    'birthday': 'urodziny',
    'bd': 'urodziny',
    'bday': 'urodziny',
    'b': 'urodziny',

    'gcreate': 'gcreate',
    'gstart': 'gcreate',
    'gend': 'gend',
    'gstop': 'gend',
    'gdelete': 'gdelete',
    'greroll': 'greroll',
    'groll': 'greroll',

    'ticket': 'ticket',
    't': 'ticket',
    'new': 'ticket',

    'pogoda': 'pogoda',
    'weather': 'pogoda',
    'zglos': 'zglos',
    'report': 'zglos',
    'userinfo': 'userinfo',
    'whois': 'userinfo',
    'ui': 'userinfo',

    'statystyki': 'statystyki',
    'serverstats': 'statystyki',
    'ss': 'statystyki',
    'sstats': 'statystyki',

    'przejmij': 'przejmij',
    'claim': 'przejmij',
    'zamknij': 'zamknij',
    'close': 'zamknij',
    'priorytet': 'priorytet',
    'priority': 'priorytet',
    'zaproszenia': 'zaproszenia',
    'invites': 'zaproszenia',
    'konkurs': 'konkurs',
    'giveaway': 'konkurs',
    'liczenie': 'liczenie',
    'count': 'liczenie',
    'logi': 'logi',
    'logging': 'logi',

    'rr': 'reactroles',
    'reactionroles': 'reactroles',

    'jtc': 'jointocreate',
    'jointocreate': 'jointocreate',

    'np': 'nowplaying',
    'now': 'nowplaying',
};

export const subcommandAliases = {
    'l': 'list',
    'ls': 'list',
    's': 'set',
    'i': 'info',
    'r': 'remove',
    'rm': 'remove',
    'del': 'remove',
    'n': 'next',
    'sc': 'setchannel',

    'a': 'add',
    'c': 'complete',
    'done': 'complete',
    'd': 'complete',

    'start': 'create',
    'stop': 'end',

    'add': 'add',
    'remove': 'remove',
    'list': 'list',
};

/**
 * Resolve a command alias to its full command name
 * @param {string} commandName - The command name (could be an alias)
 * @returns {string} - The full command name, or the original if not an alias
 */
export function resolveCommandAlias(commandName) {
    const normalized = commandName.toLowerCase();
    return commandAliases[normalized] || commandName;
}

/**
 * Resolve a subcommand alias to its full subcommand name
 * @param {string} subcommandName - The subcommand name (could be an alias)
 * @returns {string} - The full subcommand name, or the original if not an alias
 */
export function resolveSubcommandAlias(subcommandName) {
    const normalized = subcommandName.toLowerCase();
    return subcommandAliases[normalized] || subcommandName;
}
