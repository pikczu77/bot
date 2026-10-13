// automodPresets.js — ready-made lists the web panel can insert into the automod rules.
//
// Words are matched after lowercasing and stripping Polish letters (ą→a, ł→l, ś→s ...),
// so they are written without diacritics. `*` stands for any letters, and a word only
// matches as a whole word: `kurw*` catches "kurwa", `*kurw*` also "skurwysyn".
// Some words are listed as exact forms on purpose, because a wildcard would hit
// innocent words: `cip*` would catch "principle", `dup*` "duplikat", `rucha*` "ruchami".

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
