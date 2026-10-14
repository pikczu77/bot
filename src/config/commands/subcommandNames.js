// subcommandNames.js — old English subcommand names that were renamed to Polish.
//
// Prefix commands still accept the English word (`!bank deposit 50`): when a
// command has no subcommand with the typed name, the parser tries the Polish one.

export const legacySubcommandNames = {
    'set': 'ustaw',
    'list': 'lista',
    'next': 'nastepne',
    'setchannel': 'kanal',
    'add': 'dodaj',
    'remove': 'usun',
    'delete': 'usun',
    'enable': 'wlacz',
    'disable': 'wylacz',
    'deposit': 'wplac',
    'withdraw': 'wyplac',
    'create': 'utworz',
    'end': 'zakoncz',
    'reroll': 'losuj-ponownie',
    'rewards': 'nagrody',
    'reward-add': 'nagroda-dodaj',
    'reward-remove': 'nagroda-usun',
    'sync': 'synchronizuj',
    'lock': 'zablokuj',
    'unlock': 'odblokuj',
    'slowmode': 'wolny-tryb',
    'sticky': 'przypnij',
    'unsticky': 'odepnij',
    'history': 'historia',
    'all': 'wszyscy',
    'contact': 'kontakt',
    'reply': 'odpowiedz',
    'close': 'zamknij',
    'block': 'zablokuj',
    'unblock': 'odblokuj',
    'snippet-add': 'szablon-dodaj',
    'snippet-remove': 'szablon-usun',
    'snippet': 'szablon',
    'snippets': 'szablony',
};

/**
 * Find a subcommand by its typed name, falling back to the Polish name of an old English one.
 * @param {Array<{name: string}>} subcommands
 * @param {string} name
 */
export function findSubcommand(subcommands, name) {
    return subcommands.find((s) => s.name === name)
        ?? subcommands.find((s) => s.name === legacySubcommandNames[name]);
}
