// automodPresets.js — ready-made lists the web panel can insert into the automod rules.
//
// Words are matched after lowercasing and stripping Polish letters (ą→a, ł→l, ś→s ...),
// so they are written without diacritics. `*` stands for any letters, and a word only
// matches as a whole word: `kurw*` catches "kurwa", `*kurw*` also "skurwysyn".
// Some words are listed as exact forms on purpose, because a wildcard would hit
// innocent words: `cip*` would catch "principle", `dup*` "duplikat", `rucha*` "ruchami".

/**
 * Words the words rule lets through even when a pattern of the list matches them (2026-10-29, owner:
 * "niech zajebiscie nie usuwa"; `*jeb*` caught it). Same writing as the list: no Polish letters, `*` = any letters.
 */
export const PRESET_ALLOWED_WORDS = ['zajebisc*', 'zajebist*'];

/** Polish swear words and insults. */
export const PRESET_WORDS = [
  // kurwa
  '*kurw*', '*kurew*',
  // jebać, zajebisty, pojeb, wyjebane ...
  '*jeb*',
  // pierdolić, spierdalaj ...
  '*pierdol*', '*pierdal*',
  // chuj, chujowy, huj ...
  '*chuj*', 'huj*',
  // pizda, piździec ...
  '*pizd*',
  'cipa', 'cipy', 'cipe', 'cipie', 'cipo', 'cipka', 'cipki', 'cipke', 'cipko', 'cipsko',
  'kutas*', 'fiut*',
  'dupa', 'dupy', 'dupe', 'dupie', 'dupo', 'dupsko', 'dupek', 'dupka', 'dupku', 'dupki',
  'gowno*', 'gowna*', 'gowni*', 'gownem',
  'zasran*', 'posran*', 'obsran*', 'wysran*', 'srac', 'sraj*',
  'ruchac', 'ruchanie', 'ruchal*', 'ruchaj*', 'wyruch*',
  'dziwk*', 'szmata', 'szmato', 'szmaty', 'szmacie', 'suka', 'suko',
  'sukinsyn*', 'skurwiel*',
  // insults
  'debil*', 'idiot*', 'kretyn*', 'matol*', 'cwel*', 'frajer*', 'downie',
  'pedal', 'pedale', 'pedaly', 'pedalem', 'pedzio*', 'pedziu*', 'ciota', 'cioto', 'cioty', 'ciote',
  'lachociag*', 'chwdp',
  // sexual words, not for a young audience (2026-10-26, owner: "stulejka i takie nieodpowiednie
  // słowa dla młodszej widowni też usuwaj", "dih"). Exact forms where a wildcard would hit innocent
  // words: `zboczen*` would catch "zboczenie z trasy", `cyc*` "cyklon".
  'stulej*', 'dih', 'dihh', 'dick*', 'cock', 'cocks', 'penis*',
  'cycki', 'cycek', 'cyckami', 'cycuszki', 'cycuszek',
  'seks', 'seksu', 'seksem', 'seksie', 'seksi', 'seksown*', 'sex', 'sexy', 'horny', 'cum',
  'masturb*', 'wal* konia', 'obciag*', 'sperm*', 'orgazm*',
  'zboczeniec', 'zboczencu', 'zboczency', 'zbok', 'zboku', 'zboki',
];

/**
 * Slurs: racist and homophobic words the owner never allows, also at night and on channels
 * where swearing is free (2026-10-15: "na nigger, cwel i tego typu podobne słownictwo nie
 * pozwalam nawet po 22"). Checked by the automod "slurs" rule after digits and symbols are
 * read as letters (n1gg3r, c\/\/el).
 */
export const PRESET_SLURS = [
  // racist
  // (words with an innocent meaning - asfalt, bambus - are left out on purpose)
  'nigg*', 'nigga*', 'niga', 'neger*', 'negr', 'negro', 'czarnuch*',
  // homophobic and transphobic
  'cwel*', 'faggot*', 'fagot*', 'fag', 'fags', 'pedal', 'pedale', 'pedaly', 'pedalem', 'pedalski*',
  'pedzio*', 'pedziu*', 'ciota', 'cioty', 'cioto', 'ciote', 'ciotami', 'ciotowat*', 'tranny', 'trannies',
  // sexual content and abuse: the server has young members, so never, also on the night chat
  // (2026-10-26, owner: "nudes itp", "pedofil"; never-instead-of-words is my call)
  'nudes*', 'pedofil*', 'pedophil*', 'pedo', 'pedos', 'porn*', 'hentai*', 'rule34', 'r34',
  'onlyfans*', 'dickpic*', 'xvideos*', 'xhamster*', 'sexting*', 'seksting*',
];

/** GIF sites and YouTube. Subdomains are allowed too (media.tenor.com, m.youtube.com). */
export const PRESET_LINKS = [
  'youtube.com',
  'youtu.be',
  'tenor.com',
  'giphy.com',
  'klipy.com',
  'gfycat.com',
  'imgur.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
];
