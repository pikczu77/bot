// What Klubiś (the bot) says by itself (2026-11-01, services/klubis.js). Polish only: the main server is Polish and the
// server has young members, so every line stays clean.
//
// A skill matches the message text folded by `fold` (lower case, no Polish letters, punctuation as spaces), after the bot's
// name and mention are taken out. `alone: true` = it may also answer a message that does not call Klubiś (with the
// server's chance and break). Order matters: the first match wins. {user} = the member's name, {server} = server name.

export const KLUBIS_SKILLS = [
  {
    id: 'who', label: 'Kim jest', example: 'Klubiś, kim jesteś?',
    match: /\b(kim|czym) (ty )?jestes\b|\bco (ty )?za (jeden|bot)\b|\bjestes (botem|bot|czlowiekiem)\b/,
    replies: [
      'Jestem Klubiś, bot tego serwera. Dopiero uczę się pisać, więc bądź wyrozumiały 😅',
      'Klubiś, do usług! Pilnuję porządku, liczę kasę i czasem pogadam.',
      'Bot. Ale z charakterem 😎',
    ],
  },
  {
    id: 'how', label: 'Jak się ma', example: 'Klubiś, co tam?',
    match: /\bjak (sie )?(masz|tam|leci|zyjesz)\b|\bco (tam|slychac|u ciebie)\b|\bwszystko (ok|dobrze|git)\b/,
    replies: [
      'Dobrze! Przed chwilą policzyłem całą kasę na serwerze 💰',
      'Spoko, tylko trochę się nudzę między wiadomościami.',
      'Super! A u ciebie, {user}?',
      'Jak to bot: zawsze online, zawsze gotowy 🤖',
    ],
  },
  {
    id: 'love', label: 'Komplementy', example: 'Klubiś, kocham cię',
    match: /\b(kocham|lubie|uwielbiam) (cie|ciebie)\b|\bjestes (super|najlepszy|kochany|fajny|spoko|mega)\b|\b(dobry|fajny|najlepszy) bot\b|\bgood bot\b/,
    replies: [
      'Ojej, ja ciebie też, {user} 🥹',
      'Wiem, wiem 😎 Ale miło to słyszeć!',
      'Zapisuję to w pamięci. Na zawsze 💾💜',
    ],
  },
  {
    id: 'mean', label: 'Zaczepki', example: 'Klubiś, jesteś głupi',
    match: /\b(glupi|glupek|glupku|debil|idiota|beznadziejny|slaby|smierdzisz|frajer|noob|nub)\b|\b(zly|glupi|slaby) bot\b|\bbad bot\b|\bnie lubie cie\b/,
    replies: [
      'Auć. Zapamiętam to przy następnym /rob 👀',
      'Jestem botem, nie mam uczuć. Chyba 🥲',
      'To było niemiłe, {user}. Ale ci wybaczam.',
      'Też cię lubię 🙃',
    ],
  },
  {
    id: 'thanks', label: 'Podziękowania', example: 'Dzięki, Klubiś!',
    match: /\b(dzieki|dziekuje|dziekuwa|dzienks|dzk|thx|thanks)\b/,
    replies: ['Nie ma za co! 💜', 'Spoko, polecam się na przyszłość 😎', 'Zawsze do usług, {user}!'],
  },
  {
    id: 'joke', label: 'Żarty', example: 'Klubiś, opowiedz żart',
    match: /\b(zart|zarty|dowcip|kawal|rozsmiesz)\b|\bcos smiesznego\b/,
    replies: [
      'Dlaczego Creeper nie ma znajomych? Bo zawsze wybucha w złym momencie 💥',
      'Jak się nazywa Enderman na wakacjach? Teleturysta 🧳',
      'Steve znalazł diamenty. Koniec żartu, bo zaraz potem wpadł do lawy 🥲',
      'Dlaczego szkielet nie poszedł na imprezę? Nie miał z kim się bawić... ani ciała 💀',
      'Dlaczego Enderman nie gra w chowanego? Bo teleportuje się, zanim ktoś zacznie liczyć 🟪',
      'Mój ulubiony blok? Blok kodu. Tylko nikomu nie mów 🤫',
    ],
  },
  {
    id: 'doing', label: 'Co robi', example: 'Klubiś, co robisz?',
    match: /\bco (ty )?(robisz|porabiasz)\b|\bczym sie zajmujesz\b/,
    replies: ['Pilnuję czatu i liczę XP. A ty?', 'Patrzę, kto ile ma kasy 👀', 'Uczę się pisać. Coraz lepiej mi idzie, nie?'],
  },
  {
    id: 'bored', label: 'Nuda', example: 'nudzi mi się', alone: true,
    match: /\bnudzi mi sie\b|\bnuda\b|\bnudy\b|\bnudno\b/,
    replies: [
      'Nudzi ci się? Spróbuj /wordle albo /quiz 🎯',
      'Zagraj w /wisielec, zawsze to coś!',
      'Możesz zarobić trochę kasy: /work 💼',
      'A może /paczka? Może trafisz legendę 👑',
    ],
  },
  {
    id: 'hello', label: 'Powitania', example: 'siema', alone: true,
    match: /^(siema|siemka|siemano|siemanko|hej|hejka|hejo|heja|czesc|elo|elo elo|witam|witajcie|hello|hi|yo|jol)\b/,
    replies: ['Siema, {user}! 👋', 'Hejka! Co tam?', 'Elo elo 😎', 'Cześć! Miło cię widzieć na {server}.'],
  },
  {
    id: 'morning', label: 'Dzień dobry', example: 'dzień dobry', alone: true,
    match: /\bdzien (dobry|doberek)\b|\b(wstalem|wstalam)\b/,
    replies: ['Dzień dobry! ☀️ Nie zapomnij o /daily!', 'Dzień dobry, {user}! Kawa już jest? ☕'],
  },
  {
    id: 'night', label: 'Dobranoc', example: 'dobranoc', alone: true,
    match: /\b(dobranoc|dobranocka|branoc)\b|\b(ide|lece|spadam|pora) spac\b/,
    replies: ['Dobranoc, {user}! 🌙', 'Śpij dobrze! Rano czeka /daily 💤', 'Dobranoc! Nie śnij o creeperach 💥'],
  },
  {
    id: 'bye', label: 'Pożegnania', example: 'nara', alone: true,
    match: /^(narka|nara|pa pa|papa|pa|do zobaczenia|bye|lece|spadam|uciekam)$/,
    replies: ['Nara! 👋', 'Do zobaczenia, {user}!', 'Pa pa! Wracaj szybko 💜'],
  },
  {
    id: 'gg', label: 'GG', example: 'gg', alone: true,
    match: /^gg( wp| ez| ezz)?$/,
    replies: ['GG! 🏆', 'gg wp 😎'],
  },
  {
    id: 'question', label: 'Pytania tak/nie', example: 'Klubiś, czy jutro będzie padać?',
    match: /^czy\b/,
    question: true,
    replies: ['Tak.', 'Nie.', 'Raczej tak 🤔', 'Raczej nie.', 'Na sto procent!', 'Nie licz na to.', 'Zapytaj jutro 😴', 'Moje bity mówią, że tak.', 'Hmm... może?'],
  },
];

// Only the name or a mention, no other text.
export const KLUBIS_CALLED = ['Tak? 👀', 'Wołałeś mnie, {user}?', 'Jestem! Co trzeba?'];

// Called, but no skill matched.
export const KLUBIS_UNKNOWN = [
  'Hm? Dopiero się uczę, nie wszystko rozumiem 😅',
  'Nie ogarniam, ale brzmi mądrze 🤔',
  'Ciekawe... opowiedz więcej!',
  'Zapisuję to w notesie. Kiedyś zrozumiem 📓',
  '😂',
  'Serio?',
];
