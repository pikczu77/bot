// What Klubiś (the bot) says by itself (2026-11-01, services/klubis.js). Polish only: the main server is Polish and the
// server has young members, so every line stays clean.
//
// A skill matches the message text folded by `fold` (lower case, no Polish letters, punctuation as spaces), after the bot's
// name and mention are taken out. `alone: true` = it may also answer a message that does not call Klubiś (with the
// server's chance and break). Order matters: the first match wins. {user} = the member's name, {server} = server name.

// "Co robisz?" to Klubiś and "co robicie?" to the chat (owner asked for 20).
const DOING = [
  'Ja pilnuję czatu, żeby nikt nie przeklinał 👀',
  'Liczę, kto ma najwięcej kasy na serwerze 💰',
  'Gram w Minecrafta w głowie. Właśnie znalazłem diamenty 💎',
  'Uczę się pisać. Coraz lepiej mi idzie, nie? 😅',
  'Oglądam ostatni film Pikczu po raz dziesiąty 🎬',
  'Rozdaję XP za wiadomości. Pisz dalej, to wbijesz poziom ⭐',
  'Nic, nudzę się. Zagra ktoś w `/wisielec`? 🎯',
  'Szukam creepera, który wysadził mi dom 💥',
  'Układam jutrzejsze słowo do `/wordle` 🟩 Nie powiem jakie!',
  'Czekam, aż ktoś odbierze `/daily` 👀',
  'Pilnuję giełdy. Kebab u Stefana znowu rośnie 📈',
  'Sprzątam po ostatnim `/napad` 🚔',
  'Siedzę z wami na czacie, a co mam robić? 😎',
  'Słucham muzyki. Puść coś przez `/play` 🎵',
  'Liczę, ile razy dzisiaj ktoś napisał „xd” 😂',
  'Trenuję żarty. Napisz „Klubiś, opowiedz żart” 😏',
  'Planuję następny drop na czacie 🎁 Bądź czujny!',
  'Odpoczywam po nocnej zmianie. Boty też się męczą 😴',
  'Kibicuję wam w `/pojedynek` ✊✋✌️',
  'Patrzę, czy nikt nie spamuje. Wszystko pod kontrolą 🛡️',
];

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
    replies: DOING,
  },
  {
    // Owner: "co robicie (daj mu 20 odpowiedzi na co robicie)". Asked to everyone, so it works without a call, and `always`
    // skips the server's chance (only the break of this skill on the channel holds it back).
    id: 'doingAll', label: 'Co robicie', example: 'co robicie?', alone: true, always: true,
    match: /\bco (wy )?(tam )?(robicie|porabiacie|robimy)\b|\bco (dzis|teraz) (robicie|robimy)\b/,
    replies: DOING,
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
    match: /^(siema|siemka|siemano|siemanko|hej|hejka|hejo|heja|czesc|elo|elo elo|witam|witajcie|hello|hi|yo|jol|cze|siemson|eluwa|elowina)\b/,
    replies: [
      'Siema, {user}! 👋',
      'Hejka! Co tam?',
      'Elo elo 😎',
      'Cześć! Miło cię widzieć na {server}.',
      'Siemanko, {user}! Co dziś robimy? 😄',
      'O, {user} wbija! Siema 👋',
      'Hej hej! Dobrze, że jesteś 💜',
      'Elo, {user}! `/daily` już odebrane? 💰',
      'Siema! Wpadaj, czat czeka 🗨️',
      'Cześć, {user}! Jak dzień?',
    ],
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
    id: 'update', label: 'Kiedy update', example: 'Klubiś, kiedy update?',
    match: /\bkiedy( (bedzie|wyjdzie|wchodzi|nowy|nowa|jakis|jakas))* (update|updejt|apdejt|aktualizacj[aei])\b|\b(update|updejt|apdejt|aktualizacja) kiedy\b/,
    replies: [
      'Update będzie, jak będzie gotowy 😅 Daty nie znam, Pikczu mi jej nie mówi.',
      'Cierpliwości, dobre aktualizacje wymagają czasu 🛠️',
      'Też czekam 👀 Jestem tylko botem, mnie nikt nic nie mówi.',
    ],
  },
  {
    id: 'question', label: 'Pytania tak/nie', example: 'Klubiś, czy jutro będzie padać?',
    match: /^czy\b/,
    question: true,
    replies: ['Tak.', 'Nie.', 'Raczej tak 🤔', 'Raczej nie.', 'Na sto procent!', 'Nie licz na to.', 'Zapytaj jutro 😴', 'Moje bity mówią, że tak.', 'Hmm... może?'],
  },
];

// Answers about the server, written by me on the owner's "napisz sam te rzeczy" (2026-11-01). They go once into the taught list
// ("Naucz Klubisia", tagService `responders`) of every server, so the owner can change or delete them in the panel. Questions only,
// never single common words, so Klubiś does not answer every message that mentions money. Links in <> get no Discord preview.
// Facts: YouTube @Pikczu77 and @PikczuDaily, TikTok and Instagram pikczu77 (pikczu.pl footer); Club SMP is private and its address
// is never given (owner); pikczu.pl/donate = Tipply codes that run in the game live.
const YT = '<https://youtube.com/@Pikczu77>';
const EARN = [
  'Najprościej: `/daily` raz dziennie, potem `/work`, `/fish` i `/nagraj` 💰',
  'Zacznij od `/daily`, a potem pracuj: `/work`, `/fish`, `/nagraj`. Cały poradnik jest na #ekonomia-info 📖',
];
const LEVEL = [
  'Pisz na czacie i siedź na kanałach głosowych, XP leci samo ⭐ Swój poziom sprawdzisz w `/poziom`.',
  'XP dostajesz za wiadomości i rozmowy na głosowym. Ranking: `/top` 🏆',
];
const STAFF = [
  'Ekipę wybiera Pikczu. Bądź aktywny, miły i trzymaj się regulaminu 😉',
  'Nie ma zgłoszeń na admina. Najlepsza droga: być fajnym na serwerze 💜',
];
const VIDEO = [
  `Nowy film będzie, jak będzie gotowy 🎬 Włącz dzwoneczek: ${YT} 🔔`,
  `Cierpliwości, dobre filmy wymagają czasu 🎬 Dzwoneczek na ${YT} i nic nie przegapisz!`,
];
const CHANNELS = [`Główny kanał: ${YT} 🎬 Drugi: <https://youtube.com/@PikczuDaily>`];
const SOCIALS = ['TikTok: <https://tiktok.com/@pikczu77> 📱 Instagram: <https://instagram.com/pikczu77> 📸'];
const SMP = ['Club SMP to prywatny serwer youtuberów, nie da się na niego wejść 🔒 Kto gra i co się dzieje: <https://pikczu.pl/smp>'];
const DONATE = ['Wpłacasz przez Tipply z kodem akcji w wiadomości (np. `!zombie`), a akcja dzieje się w grze na żywo 💸 Lista kodów: <https://pikczu.pl/donate>'];
const TICKET = ['Otwórz ticket przyciskiem na kanale z ticketami: dostaniesz prywatny kanał z ekipą 🎫'];

export const KLUBIS_STARTER = [
  { trigger: 'jak zarobić', mode: 'contains', responses: EARN },
  { trigger: 'jak zdobyć kasę', mode: 'contains', responses: EARN },
  { trigger: 'jak wbić poziom', mode: 'contains', responses: LEVEL },
  { trigger: 'jak zdobyć xp', mode: 'contains', responses: LEVEL },
  { trigger: 'jak dostać rangę', mode: 'contains', responses: ['Rangi za poziomy przychodzą same, gdy wbijasz kolejne poziomy. Swój poziom: `/poziom` ⭐', 'Rangi eventowe kupisz w `/event sklep`, a założysz w `/eq` 🎃'] },
  { trigger: 'jak zostać adminem', mode: 'contains', responses: STAFF },
  { trigger: 'jak zostać moderatorem', mode: 'contains', responses: STAFF },
  { trigger: 'kiedy film', mode: 'contains', responses: VIDEO },
  { trigger: 'kiedy nowy film', mode: 'contains', responses: VIDEO },
  { trigger: 'kanał pikczu', mode: 'contains', responses: CHANNELS },
  { trigger: 'link do yt', mode: 'contains', responses: CHANNELS },
  { trigger: 'kim jest pikczu', mode: 'contains', responses: [`Pikczu to youtuber od Minecrafta i szef tego serwera 😎 ${YT}`] },
  { trigger: 'tiktok pikczu', mode: 'contains', responses: SOCIALS },
  { trigger: 'insta pikczu', mode: 'contains', responses: SOCIALS },
  { trigger: 'ip serwera', mode: 'word', responses: SMP },
  { trigger: 'jak wejść na smp', mode: 'contains', responses: SMP },
  { trigger: 'jak zrobić donate', mode: 'contains', responses: DONATE },
  { trigger: 'kody donate', mode: 'contains', responses: DONATE },
  { trigger: 'jak puścić muzykę', mode: 'contains', responses: ['Wejdź na kanał głosowy i wpisz `/play` z nazwą piosenki albo linkiem 🎵'] },
  { trigger: 'jak założyć ticket', mode: 'contains', responses: TICKET },
  { trigger: 'jak napisać do adminów', mode: 'contains', responses: TICKET },
  { trigger: 'jakie są komendy', mode: 'contains', responses: ['Wszystkie komendy pokaże `/komendy` 📋'] },
  { trigger: 'lista komend', mode: 'contains', responses: ['Wszystkie komendy pokaże `/komendy` 📋'] },
  { trigger: 'gdzie regulamin', mode: 'contains', responses: ['Regulamin jest na kanale z zasadami 📜 Przeczytaj go, zanim coś napiszesz!'] },
  { trigger: 'kiedy event', mode: 'contains', responses: ['Eventy świąteczne startują same w swoje dni. Co jest w tym roku: `/event lista` 🎉'] },
  { trigger: 'co daje boost', mode: 'contains', responses: ['Wszystko o nagrodach za boost: `/booster info` 💎'] },
  { trigger: 'jak grać w wordle', mode: 'contains', responses: ['Nowe Wordle jest codziennie o północy: `/wordle` 🟩 Masz 6 prób na słowo z 5 liter.'] },
  { trigger: 'jak ustawić urodziny', mode: 'contains', responses: ['Wpisz `/urodziny ustaw`, a w swój dzień dostaniesz życzenia 🎂'] },
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
