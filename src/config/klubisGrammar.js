// How Klubiś reads a sentence (2026-11-01, owner: "rozwin to tak zeby te odpowiedzi mialy sens prawie zawsze, sprobuj zrobic tak zeby on rozumial").
// No AI: services/klubisBrain.js finds who the sentence is about and its verb, turns it around ("lubię pizzę" -> "lubisz pizzę") and picks
// lines for that kind of sentence. Words are compared folded (no Polish letters), so "lubie" = "lubię". The server is 16+. Lines stay free
// of sexual content all the same, because members can be 16 or 17.

// The verbs it knows, as [I, you], by what the sentence is about. A new verb only needs a line here.
export const VERB_GROUPS = {
  like: [['lubię', 'lubisz'], ['uwielbiam', 'uwielbiasz'], ['kocham', 'kochasz'], ['ubóstwiam', 'ubóstwiasz'], ['wolę', 'wolisz']],
  hate: [['nienawidzę', 'nienawidzisz'], ['znoszę', 'znosisz'], ['cierpię', 'cierpisz']],
  play: [['gram', 'grasz'], ['pogram', 'pograsz'], ['zagram', 'zagrasz'], ['pogrywam', 'pogrywasz']],
  have: [['mam', 'masz'], ['posiadam', 'posiadasz']],
  want: [['chcę', 'chcesz'], ['potrzebuję', 'potrzebujesz'], ['marzę', 'marzysz'], ['szukam', 'szukasz'], ['planuję', 'planujesz']],
  go: [
    ['idę', 'idziesz'], ['jadę', 'jedziesz'], ['lecę', 'lecisz'], ['wychodzę', 'wychodzisz'], ['wracam', 'wracasz'], ['pójdę', 'pójdziesz'], ['pojadę', 'pojedziesz'],
    ['chodzę', 'chodzisz'], ['jeżdżę', 'jeździsz'], ['uciekam', 'uciekasz'], ['zmykam', 'zmykasz'], ['spadam', 'spadasz'], ['wpadam', 'wpadasz'], ['biegnę', 'biegniesz'],
  ],
  do: [
    ['robię', 'robisz'], ['oglądam', 'oglądasz'], ['słucham', 'słuchasz'], ['czytam', 'czytasz'], ['piszę', 'piszesz'], ['rysuję', 'rysujesz'], ['buduję', 'budujesz'],
    ['uczę', 'uczysz'], ['pracuję', 'pracujesz'], ['ćwiczę', 'ćwiczysz'], ['śpiewam', 'śpiewasz'], ['tańczę', 'tańczysz'], ['nagrywam', 'nagrywasz'], ['montuję', 'montujesz'],
    ['streamuję', 'streamujesz'], ['programuję', 'programujesz'], ['zbieram', 'zbierasz'], ['kupuję', 'kupujesz'], ['sprzedaję', 'sprzedajesz'], ['zarabiam', 'zarabiasz'],
    ['wydaję', 'wydajesz'], ['biorę', 'bierzesz'], ['daję', 'dajesz'], ['dostaję', 'dostajesz'], ['czekam', 'czekasz'], ['pomagam', 'pomagasz'], ['sprzątam', 'sprzątasz'],
    ['gotuję', 'gotujesz'], ['szykuję', 'szykujesz'], ['trenuję', 'trenujesz'], ['biegam', 'biegasz'], ['pływam', 'pływasz'], ['wygrywam', 'wygrywasz'], ['przegrywam', 'przegrywasz'],
    ['rozmawiam', 'rozmawiasz'], ['gadam', 'gadasz'], ['naprawiam', 'naprawiasz'], ['testuję', 'testujesz'], ['ogarniam', 'ogarniasz'], ['próbuję', 'próbujesz'], ['tworzę', 'tworzysz'],
    ['myję', 'myjesz'], ['szyję', 'szyjesz'], ['żyję', 'żyjesz'], ['kopię', 'kopiesz'], ['śmieję', 'śmiejesz'], ['płaczę', 'płaczesz'], ['krzyczę', 'krzyczysz'], ['skaczę', 'skaczesz'], ['palę', 'palisz'],
    ['noszę', 'nosisz'], ['proszę', 'prosisz'], ['płacę', 'płacisz'], ['dzwonię', 'dzwonisz'], ['kończę', 'kończysz'], ['liczę', 'liczysz'], ['patrzę', 'patrzysz'], ['tęsknię', 'tęsknisz'], ['gonię', 'gonisz'],
    ['walczę', 'walczysz'], ['ciągnę', 'ciągniesz'], ['budzę', 'budzisz'], ['wstaję', 'wstajesz'], ['zostaję', 'zostajesz'], ['nudzę', 'nudzisz'], ['kłamię', 'kłamiesz'], ['żartuję', 'żartujesz'], ['niosę', 'niesiesz'],
    ['piekę', 'pieczesz'], ['tnę', 'tniesz'], ['rzucam', 'rzucasz'], ['klikam', 'klikasz'], ['strzelam', 'strzelasz'], ['wołam', 'wołasz'], ['pytam', 'pytasz'], ['chowam', 'chowasz'], ['zmieniam', 'zmieniasz'],
    ['odpowiadam', 'odpowiadasz'], ['otwieram', 'otwierasz'], ['zamykam', 'zamykasz'], ['wysyłam', 'wysyłasz'], ['zaczynam', 'zaczynasz'], ['zapominam', 'zapominasz'], ['sprawdzam', 'sprawdzasz'], ['dodaję', 'dodajesz'],
  ],
  eat: [['jem', 'jesz'], ['piję', 'pijesz'], ['zjem', 'zjesz'], ['wypiję', 'wypijesz'], ['zamawiam', 'zamawiasz']],
  think: [['myślę', 'myślisz'], ['sądzę', 'sądzisz'], ['uważam', 'uważasz'], ['wierzę', 'wierzysz'], ['czuję', 'czujesz'], ['mówię', 'mówisz'], ['twierdzę', 'twierdzisz'], ['zgadzam', 'zgadzasz']],
  know: [['wiem', 'wiesz'], ['znam', 'znasz'], ['rozumiem', 'rozumiesz'], ['pamiętam', 'pamiętasz'], ['słyszę', 'słyszysz'], ['widzę', 'widzisz']],
  can: [['umiem', 'umiesz'], ['potrafię', 'potrafisz'], ['mogę', 'możesz']],
  must: [['muszę', 'musisz'], ['powinienem', 'powinieneś'], ['powinnam', 'powinnaś']],
  be: [['jestem', 'jesteś']],
  live: [['mieszkam', 'mieszkasz'], ['siedzę', 'siedzisz'], ['leżę', 'leżysz'], ['śpię', 'śpisz'], ['stoję', 'stoisz']],
  future: [
    ['będę', 'będziesz'], ['zrobię', 'zrobisz'], ['kupię', 'kupisz'], ['napiszę', 'napiszesz'], ['sprawdzę', 'sprawdzisz'], ['spróbuję', 'spróbujesz'], ['wezmę', 'weźmiesz'],
    ['powiem', 'powiesz'], ['obejrzę', 'obejrzysz'], ['wygram', 'wygrasz'], ['przegram', 'przegrasz'], ['zdam', 'zdasz'], ['dostanę', 'dostaniesz'], ['zostanę', 'zostaniesz'],
    ['wyślę', 'wyślesz'], ['odpiszę', 'odpiszesz'], ['zadzwonię', 'zadzwonisz'], ['przyjdę', 'przyjdziesz'], ['wejdę', 'wejdziesz'], ['wyjdę', 'wyjdziesz'], ['znajdę', 'znajdziesz'], ['wstanę', 'wstaniesz'],
    ['zasnę', 'zaśniesz'], ['wrócę', 'wrócisz'], ['skończę', 'skończysz'], ['zacznę', 'zaczniesz'], ['pokażę', 'pokażesz'], ['opowiem', 'opowiesz'], ['odpowiem', 'odpowiesz'], ['dam', 'dasz'], ['oddam', 'oddasz'],
    ['sprzedam', 'sprzedasz'], ['zapomnę', 'zapomnisz'], ['przypomnę', 'przypomnisz'], ['przeczytam', 'przeczytasz'], ['posłucham', 'posłuchasz'], ['pomyślę', 'pomyślisz'], ['zjadę', 'zjedziesz'],
    ['poczekam', 'poczekasz'], ['pomogę', 'pomożesz'], ['zbuduję', 'zbudujesz'], ['zapamiętam', 'zapamiętasz'], ['zobaczę', 'zobaczysz'], ['nauczę', 'nauczysz'],
  ],
  fear: [['boję', 'boisz']],
};

// Words that end like a verb and are not one.
export const NOT_VERB_AM = new Set(['tam', 'sam', 'nam', 'wam', 'program', 'adam', 'islam', 'salam', 'instagram', 'telegram', 'diagram', 'kilogram', 'madam', 'balsam', 'reklam', 'kwiatam', 'kolegam', 'siam', 'wietnam', 'amsterdam', 'kram', 'tram']);
export const NOT_VERB_ASZ = new Set(['nasz', 'wasz', 'tomasz', 'lukasz', 'kasz', 'gulasz', 'afisz', 'kosz', 'pasz', 'mysz', 'towarzysz', 'nisz', 'arkusz', 'tysz']);
// How an unknown verb goes from "you" to "I" (folded ending -> ending). The longest that fits: "lubisz"-type verbs have their own rule below.
export const YOU_TO_ME = [['ujesz', 'uję'], ['ijesz', 'iję'], ['ajesz', 'aję'], ['ejesz', 'eję'], ['niesz', 'nę'], ['dziesz', 'dę'], ['cisz', 'cę'], ['dzisz', 'dzę'], ['sisz', 'szę'], ['zisz', 'żę'], ['lisz', 'lę'], ['ysz', 'ę'], ['isz', 'ię'], ['asz', 'am']];
// From "I" to "you", when the word plainly is a verb: spelled with ę, or after "ja".
export const ME_TO_YOU = [['uję', 'ujesz'], ['iję', 'ijesz'], ['aję', 'ajesz'], ['eję', 'ejesz'], ['nę', 'niesz'], ['czę', 'czysz'], ['rzę', 'rzysz'], ['szę', 'sisz'], ['dzę', 'dzisz'], ['dę', 'dziesz'], ['cę', 'cisz'], ['żę', 'zisz'], ['lę', 'lisz'], ['ię', 'isz']];

// Common words typed without Polish letters. What Klubiś says back is written properly.
export const WITH_ACCENTS = {
  cala: 'cała', calo: 'cało', cale: 'całe', caly: 'cały', calej: 'całej', dzis: 'dziś', juz: 'już', sie: 'się', moze: 'może', tez: 'też', duzo: 'dużo', malo: 'mało', czesc: 'cześć', sa: 'są', wiecej: 'więcej', mniej: 'mniej', dzien: 'dzień',
  ktos: 'ktoś', cos: 'coś', gdzies: 'gdzieś', jakis: 'jakiś', jakas: 'jakaś', jakies: 'jakieś', zeby: 'żeby', ze: 'że', zebym: 'żebym', wszystkie: 'wszystkie', dobrze: 'dobrze', zle: 'źle', ladny: 'ładny', ladna: 'ładna', ladnie: 'ładnie', swietny: 'świetny', swietnie: 'świetnie',
  szkola: 'szkoła', szkole: 'szkole', szkoly: 'szkoły', ksiazke: 'książkę', ksiazka: 'książka', ksiazki: 'książki', swoj: 'swój', swoja: 'swoja', swoim: 'swoim', jablko: 'jabłko', wode: 'wodę', kawe: 'kawę', herbate: 'herbatę', pizze: 'pizzę', rybe: 'rybę', dziewczyne: 'dziewczynę', prace: 'pracę', gre: 'grę', gry: 'gry', gier: 'gier', nauke: 'naukę', mame: 'mamę', tate: 'tatę', brata: 'brata', siostre: 'siostrę',
  bede: 'będę', bedzie: 'będzie', beda: 'będą', byl: 'był', byla: 'była', bylo: 'było', byly: 'były', mial: 'miał', miala: 'miała', mialo: 'miało', wczesniej: 'wcześniej', pozniej: 'później', pozno: 'późno', wieczorem: 'wieczorem', rano: 'rano', tydzien: 'tydzień', miesiac: 'miesiąc', swiat: 'świat', swieta: 'święta', przyjaciol: 'przyjaciół', kolega: 'kolega', kolezanka: 'koleżanka', zycie: 'życie',
  gdzie: 'gdzie', dokad: 'dokąd', skad: 'skąd', dlaczego: 'dlaczego', ktory: 'który', ktora: 'która', ktore: 'które', ile: 'ile', jesli: 'jeśli', jeszcze: 'jeszcze', troche: 'trochę', wlasnie: 'właśnie', naprawde: 'naprawdę', powaznie: 'poważnie', chyba: 'chyba', ciezko: 'ciężko', latwo: 'łatwo', szybko: 'szybko', wolno: 'wolno', gorszy: 'gorszy', lepszy: 'lepszy', najlepszy: 'najlepszy', mozna: 'można', trzeba: 'trzeba',
  plytke: 'płytkę', plyte: 'płytę', pieniadze: 'pieniądze', pieniedzy: 'pieniędzy', zloty: 'złoty', zlota: 'złota', zlote: 'złote', chleb: 'chleb', miesa: 'mięsa', mieso: 'mięso', piatek: 'piątek', swiatlo: 'światło', piosenke: 'piosenkę', muzyke: 'muzykę', platforme: 'platformę', jaka: 'jaka', jaki: 'jaki',
};

// Past forms that do not end in a vowel + ł: "poszedłem", "mogłam". Compared folded, without the ending.
export const PAST_STEMS = /(mogl|jadl|szedl|wszedl|wyszedl|przyszedl|poszedl|znalazl|niosl|wiozl|umarl|zarl|bral|zjadl)$/;
// Words that look like a past verb: "z kanałem", "z Michałem". Besides these, a word after a preposition is never a verb.
export const NOT_PAST = new Set(['stolem', 'kolem', 'cialem', 'dzialem', 'walem', 'malem', 'kanalem', 'michalem', 'pawlem', 'danielem', 'krolem', 'metalem', 'szpitalem', 'hotelem', 'panelem', 'modelem', 'tunelem', 'skalam', 'salam', 'islam', 'golem']);
export const PREPOSITIONS = new Set(['z', 'ze', 'nad', 'pod', 'przed', 'za', 'miedzy', 'w', 'we', 'na', 'do', 'od', 'po', 'przy', 'o', 'u', 'dla', 'bez']);

// Words turned around when a sentence is said back. Two words first ("ze mną"), then one.
export const PRONOUN_PAIRS = {
  'ze mna': 'z tobą', 'z toba': 'ze mną', 'u mnie': 'u ciebie', 'u ciebie': 'u mnie', 'do mnie': 'do ciebie', 'do ciebie': 'do mnie', 'dla mnie': 'dla ciebie',
  'dla ciebie': 'dla mnie', 'o mnie': 'o tobie', 'o tobie': 'o mnie', 'na mnie': 'na ciebie', 'na ciebie': 'na mnie', 'beze mnie': 'bez ciebie', 'bez ciebie': 'beze mnie',
};
export const PRONOUNS = {
  ja: 'ty', ty: 'ja', mnie: 'cię', cie: 'mnie', ciebie: 'mnie', mi: 'ci', ci: 'mi', mna: 'tobą', toba: 'mną', my: 'wy', wy: 'my', nas: 'was', was: 'nas', nam: 'wam', wam: 'nam',
  moj: 'twój', moja: 'twoja', moje: 'twoje', moi: 'twoi', mojego: 'twojego', mojej: 'twojej', moim: 'twoim', moich: 'twoich', moimi: 'twoimi', mojemu: 'twojemu',
  twoj: 'mój', twoja: 'moja', twoje: 'moje', twoi: 'moi', twojego: 'mojego', twojej: 'mojej', twoim: 'moim', twoich: 'moich', twoimi: 'moimi', twojemu: 'mojemu',
  nasz: 'wasz', nasza: 'wasza', nasze: 'wasze', wasz: 'nasz', wasza: 'nasza', wasze: 'nasze', naszego: 'waszego', waszego: 'naszego',
};

// Words before the verb that change nothing: "no ja dzisiaj też gram".
export const FILLERS = new Set([
  'a', 'ale', 'i', 'no', 'to', 'ja', 'ty', 'tez', 'juz', 'teraz', 'dzis', 'dzisiaj', 'wczoraj', 'jutro', 'zaraz', 'wlasnie', 'bardzo', 'czesto', 'zawsze', 'nigdy', 'ciagle',
  'wciaz', 'chyba', 'raczej', 'moze', 'serio', 'kurde', 'kurcze', 'ej', 'brat', 'bro', 'sluchaj', 'wiesz', 'wiec', 'bo', 'ze', 'tylko', 'jeszcze', 'czasem', 'ostatnio', 'tak', 'jednak', 'naprawde',
]);
// Words that only call Klubiś: "ej klubiś", "halo".
export const JUST_CALLING = new Set(['ej', 'halo', 'sluchaj', 'e', 'hop', 'puk', 'ey', 'hejo', 'no', 'bot']);
export const GREETINGS = new Set(['siema', 'siemka', 'siemano', 'siemanko', 'hej', 'hejka', 'hejo', 'heja', 'czesc', 'elo', 'witam', 'witaj', 'hello', 'hi', 'yo', 'cze', 'siemson', 'eluwa', 'elowina']);

export const QUESTION_WORDS = {
  kiedy: 'askWhen', kto: 'askWho', kogo: 'askWho', komu: 'askWho', kim: 'askWho', czyj: 'askWho', czyja: 'askWho', czyje: 'askWho',
  gdzie: 'askWhere', skad: 'askWhere', dokad: 'askWhere', dlaczego: 'askWhy', czemu: 'askWhy', ile: 'askHowMany', jak: 'askHow',
  jaki: 'askWhich', jaka: 'askWhich', jakie: 'askWhich', jakiego: 'askWhich', jakim: 'askWhich', jakiej: 'askWhich', ktory: 'askWhich', ktora: 'askWhich', ktore: 'askWhich', ktorego: 'askWhich',
  co: 'askWhat', czego: 'askWhat', czym: 'askWhat',
};

export const QUESTION_PREPOSITIONS = new Set(['na', 'w', 'we', 'do', 'z', 'ze', 'o', 'od', 'dla', 'po', 'za', 'przez', 'przy', 'u', 'nad', 'pod', 'bez']);

// Requests to Klubiś: "zrób kanapkę" -> "Mam zrobić kanapkę?". [folded command, infinitive]
export const COMMANDS = {
  zrob: 'zrobić', napisz: 'napisać', powiedz: 'powiedzieć', pokaz: 'pokazać', daj: 'dać', idz: 'iść', przestan: 'przestać', wybierz: 'wybrać', wymysl: 'wymyślić',
  wytlumacz: 'wytłumaczyć', sprawdz: 'sprawdzić', znajdz: 'znaleźć', narysuj: 'narysować', kup: 'kupić', zbuduj: 'zbudować', policz: 'policzyć', przynies: 'przynieść',
  pomoz: 'pomóc', ugotuj: 'ugotować', naucz: 'nauczyć', zapytaj: 'zapytać', odpowiedz: 'odpowiedzieć', opowiedz: 'opowiedzieć', zgadnij: 'zgadnąć', pomysl: 'pomyśleć', usun: 'usunąć', wylacz: 'wyłączyć', wlacz: 'włączyć',
};

// Folded beginnings of words that make a sentence sound good or bad.
export const GOOD_WORDS = /^(fajn|super|spoko|dobr|ekstra|zajebist|swietn|najlepsz|kox|sztos|mega|wygr|udal|ciesz|szczesliw|piekn|ladn|wspanial|genialn|kochan|mil[ayoi]\b|smieszn|zabawn)/;
export const BAD_WORDS = /^(zl[ayoe]\b|slab|beznadziej|glup|nudn|smutn|wkurz|problem|chor|boli|przegr|stracil|zepsu|rozwali|tragedi|dramat|kiepsk|okropn|straszn|fataln|debil|idiot|niemil|wredn|brzydk|lipa|lipn|cierpi|zmeczon|martw|zostawi|rzucil|zdradz|pobil|oblal|ukrad|spalil|stracil|wywalil|wyrzucil|nie dziala)/;
// Words not worth naming as the topic of a long message.
export const STOPWORDS = new Set([
  'ale', 'albo', 'bardzo', 'bede', 'bedzie', 'bylo', 'byla', 'byl', 'gdzie', 'jak', 'jaka', 'jaki', 'jakie', 'jest', 'jestem', 'jestes', 'juz', 'kiedy', 'mam', 'masz', 'mnie', 'moge', 'moze', 'nawet',
  'nich', 'nigdy', 'nic', 'oni', 'ona', 'ono', 'pod', 'przy', 'sie', 'tak', 'tam', 'tego', 'teraz', 'tez', 'tutaj', 'tylko', 'wiec', 'wszystko', 'zeby', 'ktos', 'cos', 'tego', 'tych', 'taki', 'taka', 'takie', 'czy', 'bo',
  'kurde', 'chyba', 'dzisiaj', 'wczoraj', 'jutro', 'jeszcze', 'potem', 'wtedy', 'dlatego', 'ponad', 'przez', 'dlaczego', 'czemu',
]);

// Klubiś says a member's words back, so it can be baited: "lubisz małe dzieci?" got "Czy lubię małe dzieci? Pewnie, że tak" on the live server.
// A message with one of these beginnings of a folded word is never said back or agreed with, also with the server at 16+. Add to this list freely.
export const TOUCHY_WORDS = /^(gej|gejem|lesb|homo|trans$|transk|dzieci|dzieck|dzieciak|malolat|nieletn|podlot|przedszkol|podstawowk|gimb|pedof|pedal|gwalc|gwalt|molest|seks|sex|nago$|nagi[ea]?$|nude|porn|kutas|cipk|cipa|ruchac|ruchan|hitler|nazi|faszys|holokaust|oswiecim|auschwitz|zyd|murzyn|czarnuch|cygan|rasis|rasiz|kkk|tusk|kaczynsk|nawrock|mentzen|putin|zelensk|trump|biden|narkot|dragi$|dragow|kokain|heroin|mefedron|amfetamin|marihuan|ziolo$|alkohol|wodk|piwo$|piwa$|papieros|wape$|vape$|papiez|2137|terror|zamach|bomb|kazirod|tortur|dzga|udus|podpal|otru)/;
// Only a problem about people: "jak zabić smoka" is a normal question here.
export const KILL_WORDS = /^(zabi|zabic|zabij|morder|morduj|zamorduj)/;
export const GAME_WORDS = /^(creeper|smok|zombi|szkielet|pajak|wither|warden|mob|enderman|villager|wiesniak|piglin|ghast|boss|gracz|krow|swini|owc|kurczak|npc|przeciwnik|wrog|minecraft|=?mc$|pvp|gta|cs$)/;
export const HIT_WORDS = /^(bij|bic$|bija|pobi|uderz|naparz|klepi)/;
// After "lubię", "kocham", "chcę" these need no more than that.
export const LIKE_TOUCHY = /^(mlod|mal[ae]$|malych|dziewczynk|chlopc|nastolat|\d+)/;

export const WONT_TOUCH = ['O tym ze mną nie pogadasz 🙅', 'Nie moja działka. Zmieńmy temat 🤖', 'To nie jest temat na czat 🛑', 'Pas. Zapytaj o coś innego 🙅', 'Nie, w to się nie bawię 🛑', 'Ładna próba, ale na to nie odpowiem 😏'];
export const BEING_HIT = ['Auć! Jestem tylko botem 🥲', 'Nie bij, bo zgłoszę moderacji 🛡️', 'Spokojnie, odłóż łapy 🙌', 'Ktoś tu dziś bez `/daily` 😏', 'Bicie bota nic nie da, nie mam ciała 🤖'];
export const HITTING_OTHERS = ['Nie bij nikogo, to się źle kończy 🛑', 'Przemoc to nie odpowiedź. Odpowiedzią jest `/pojedynek` ✊', 'Ej, nie. Oddychaj 🧘', 'Na to się nie piszę 🛑', 'Spokojnie. Co się stało? 👂'];

// "Lubisz X?" about something it knows nothing about: no yes, no no, and nothing said back. A yes to any words is how it got baited.
export const ASKED_UNKNOWN = ['Nie mam na to zdania 🤖', 'Mnie o to nie pytaj, jestem botem 🤖', 'Zapytaj kogoś z ciałem 😅', 'Moje bity milczą w tej sprawie 💾', 'Nie wiem. Ja znam się na Minecrafcie i czacie ⛏️', 'Nie mam pojęcia, Pikczu mnie tego nie uczył 📓', 'Trudno powiedzieć. Zapytaj mnie o coś z Minecrafta 🤔'];
// Things it can safely like. Beginnings of a folded word.
export const SAFE_LIKES = /^(pizz|kebab|burger|frytk|lod$|lody|czekolad|cukier|cola|kol[eay]$|kaw[aeyę]|herbat|sok|kot|koty|kotk|pies|psy|psa|piesk|zwierz|gr[aeyę]$|gier|gier|muzyk|piosenk|film|filmy|serial|czat|serwer|discord|minecraft|majn|roblox|fortnite|sport|pilk|nog[ae]|spac|spani|ksiazk|mem|memy|rap|rock|pikcz|diament|creeper|redstone|budowa|kopa|szkol|lekcj|matm|wakacj|lato|zim[aeyę]|wiosn|jesien|deszcz|slonc|pogod)/;

// {E} the sentence turned around, with a capital letter; {e} the same in lower case; {r} what follows the verb; {v} the verb for "you", {I} the verb for "I".
// A line with {r} is used only when something follows the verb.
export const SAID_ABOUT_SELF = {
  like: ['Czemu akurat to?', 'Odkąd?', 'A co jeszcze lubisz?', 'Opowiedz o tym 👀', 'Kto cię do tego przekonał?', 'Dobrze wiedzieć 📓'],
  likeSafe: [
    '{E}? Dobry wybór 👍', 'Czemu akurat {r}?', '{E}? Zapisuję, to ważne 📓', 'Ja też {I} {r}. No, w teorii 🤖', 'No to masz dobry gust 😎', 'Odkąd {v} {r}?', 'Szanuję. A co jeszcze {v}?', '{E}? Nie dziwię się 😄',
    'Też bym {r} polubił, gdybym mógł spróbować 🥲', 'O, ktoś tu ma pasję. Opowiedz o tym 👀', 'Ładnie. Kto cię do tego przekonał?', '{E}? To już wiem, o czym z tobą gadać 😄',
  ],
  likeNot: [
    '{E}? A co jest nie tak?', 'Rozumiem. Nie każdy musi wszystko lubić 🤷', 'Czemu nie?', 'Ja też bym nie lubił, gdybym coś lubił 🤖', 'Twoje prawo. A co lubisz zamiast tego?', '{E}? Dobra, zapisuję, żeby ci tego nie proponować 📓',
    'Odważnie 😄', 'Masz powód, czy tak po prostu?',
  ],
  hate: [
    '{E}? Mocne słowa 😳', 'Aż tak? Co się stało?', 'Spokojnie, oddychaj 🧘', 'Rozumiem. Ja tak mam z restartami 🔄', 'Nie dziwię się. Chyba. A co ci zrobiło?', 'Oj, widzę, że to poważna sprawa 👀',
  ],
  play: [
    '{E}? I jak ci idzie?', 'Długo już {v} {r}?', 'Z kim {v} {r}?', 'Daj znać, kto wygrywa 🏆', '{E}? Ja też bym chciał, ale nie mam rąk 🥲', 'Idzie ci? Tylko szczerze 😏', '{E}? Fajnie, baw się dobrze 🎮', 'Pokaż potem wyniki 📊', 'Dużo godzin w to wbite? ⏳',
  ],
  have: [
    '{E}? Od kiedy?', 'Fajnie. Długo już to masz?', '{E}? Pokaż!', 'Zazdroszczę. Ja mam tylko bity 💾', 'I jak, warto było?', 'Zapisuję: {user} ma {r} 📓', 'A skąd to masz?', 'No proszę. Jeszcze coś ukrywasz? 👀',
  ],
  haveNot: [
    '{E}? To może czas to zmienić 🤔', 'Spokojnie, jeszcze będziesz mieć 💪', 'Ja też nie mam. Ja nic nie mam 🥲', 'A chcesz mieć?', 'Szkoda. Da się to jakoś załatwić?',
  ],
  want: ['Po co ci to?', 'A skąd ten pomysł?', 'A co jeszcze masz w planach?', 'Na pewno? 🤔', 'Opowiedz o tym więcej 👂'],
  wantSafe: [
    '{E}? A co cię powstrzymuje?', 'Po co ci to?', 'To do dzieła 💪', '{E}? Mogę tylko kibicować 📣', 'A co jeszcze masz w planach?', 'Spełni się. Albo nie 🔮', 'Dobry plan. Kiedy zaczynasz?', 'Dasz radę to zdobyć? 👀',
  ],
  wantNot: ['{E}? Czemu?', 'Nikt nie każe 🤷', 'Dobra, nie naciskam 🙌', 'A co {v} zamiast tego?', 'Rozumiem. Ja też czasem nie chcę, a muszę 🤖'],
  go: ['{E}? Powodzenia 🍀', 'Baw się dobrze!', '{E}? Wracaj szybko 💜', 'Po co?', 'Na długo?', 'Uważaj na creepery po drodze 💥', 'Dobra, ja popilnuję czatu 🛡️', 'Daj znać, jak wrócisz 👋', 'O której wracasz?'],
  do: [
    '{E}? I jak, warto?', 'Fajnie. Długo już {v} {r}?', '{E}? Opowiesz potem?', 'Ja tylko pilnuję czatu, a ty {v} {r}. Zazdroszczę 😄', 'Daj znać, jak pójdzie 🤞', '{E}? Dobrze ci to idzie?',
    'W pojedynkę, czy ktoś pomaga?', 'I co z tego wyjdzie?', 'Brzmi nieźle. Pokaż, jak skończysz 👀', 'Tylko się nie przemęczaj 🛌',
  ],
  doNot: ['{E}? Czemu?', 'To co robisz w takim razie?', 'Słusznie, nikt nie każe 🤷', 'A kiedyś {v}?', 'Też bym nie robił. Mam wymówkę, jestem botem 🤖'],
  eat: ['{E}? Smacznego 🍽️', 'Smacznego! Dobre to?', 'Daj trochę. Mailem 📧', 'Aż zgłodniałem. Prądem się nie najem 🔌', '{E}? Zazdroszczę 😋', 'Zostaw mi kawałek 🍴', 'Na zdrowie! 🥤'],
  think: ['Czemu tak {v}?', '{E}? Może masz rację 🤔', 'Ciekawe. Skąd taki pomysł?', 'Trochę się z tym zgadzam. W 60% 🧮', 'Hmm, a co na to reszta czatu?', '{E}? Nie wiem, czy się zgodzę 😅', 'Masz na to dowody? 🕵️', 'Mocna teoria 🧠'],
  know: ['{E}? To mi opowiedz 👂', 'Skąd to {v}?', 'Ja nie wiem, więc mów 👀', 'I co z tym zrobisz?', 'No widzisz, a ja nie wiedziałem 🤯', 'Fajnie. Kto ci o tym powiedział?'],
  knowNot: ['{E}? Zapytaj na czacie, ktoś na pewno wie 🙋', 'Nic nie szkodzi, ja też nie wiem 😅', 'Sprawdźmy razem. Znaczy ty sprawdź 🔍', 'Spokojnie, nikt nie wie wszystkiego.', 'Co dokładnie cię zastanawia? 🤔'],
  can: ['{E}? Od kiedy?', 'Pokaż!', 'Skąd to umiesz?', 'Mocne. Nauczysz mnie? 📓', '{E}? Sprawdzę to kiedyś 👀', 'Od dawna?'],
  canNot: ['Spokojnie, nauczysz się 💪', 'Czemu nie {v}?', 'Każdy kiedyś nie umiał 📓', '{E}? Co stoi na przeszkodzie?', 'Zapytaj na czacie, może ktoś pomoże 🙋', 'To może spróbuj inaczej 🤔'],
  must: ['{E}? Współczuję 😅', 'Kto każe?', 'To idź, ja popilnuję czatu 🛡️', 'A co będzie, jak nie?', 'Dasz radę 💪', 'Długo ci to zajmie?', 'Powodzenia. Wróć potem 👋'],
  be: ['{E}? Od kiedy?', '{E}? Widać 😄', 'Serio {e}?', 'I jak ci z tym?', 'Dobrze wiedzieć 📓', 'Tak od zawsze, czy od dzisiaj?', 'Kto by pomyślał 👀'],
  beGood: ['{E}? Super, tak trzymać 💪', 'Widać to po tobie 😎', 'Cieszę się! Co się stało? 😄', 'No i o to chodzi 🙌', 'Gratki 🎉'],
  beBad: ['{E}? Trzymaj się 💜', 'Oj. Co się stało?', 'Może przerwa dobrze ci zrobi 🛌', 'Szkoda. Mogę jakoś pomóc? Chociaż pewnie nie 🥲', 'Będzie lepiej, zobaczysz ☀️', 'Chcesz o tym pogadać?'],
  live: ['{E}? Fajnie tam?', 'Ładnie tam?', '{E}? Dobrze wiedzieć 📓', 'Długo już tam?', 'Dobrze się tam siedzi?', 'A ja na serwerze. Ciasno, ale ciepło 🖥️'],
  future: ['{E}? Daj znać, jak poszło 🤞', 'Kiedy?', 'Trzymam kciuki, których nie mam 🤞', '{E}? Zapamiętam i sprawdzę 📓', 'Na pewno? 👀', 'To czekam 👀', 'Oby się udało 🍀', 'Jak nie wyjdzie, to nikomu nie powiem 🤫'],
  fear: ['Spokojnie, nie ma czego 💜', 'A czego dokładnie?', 'Ja boję się tylko restartów 😨', 'Nic ci nie będzie. Chyba 😅', 'Też bym się bał. Masz rację 😳'],
  past: ['{E}? I jak było?', 'Serio {e}? Kiedy?', 'No proszę. Warto było?', '{E}? Opowiadaj 👀', 'I co dalej?', 'Co na to inni?', 'Kiedy to było?', '{E}? Tego się nie spodziewałem 😳', 'I co na to reszta?'],
  pastNot: ['Czemu nie?', 'Może następnym razem 🤞', '{E}? Szkoda 😕', 'Nic straconego. Zawsze można nadrobić 💪', 'A chciało się chociaż?'],
};

// A yes or no question about anything else. The same question always gets the same side.
export const ANSWER_YES = ['Tak.', 'Raczej tak 🤔', 'Na sto procent!', 'Moje bity mówią, że tak.', 'Oczywiście, że tak 😎', 'Wygląda na to, że tak 👍', 'Rzut monetą mówi, że tak 🪙', 'Dla ciebie, {user}? Tak 💜', 'Jak najbardziej 👌', 'Stawiam na tak 🎲'];
export const ANSWER_NO = ['Nie.', 'Raczej nie.', 'Nie licz na to.', 'Absolutnie nie 🙅', 'Nie, chyba że bardzo chcesz 😏', 'Wygląda na to, że nie 👎', 'Rzut monetą mówi, że nie. Rzucam jeszcze raz 🪙', 'Moje bity mówią, że nie 💾', 'Szczerze? Nie sądzę 😅', 'Stawiam na nie 🎲'];
export const ANSWER_MAYBE = ['Zapytaj jutro 😴', 'Hmm... może?', 'Moje źródła mówią: nie wiadomo 🤷', 'Teraz nie mogę ci tego powiedzieć 🤐', 'Może być. Czemu nie? 🤷', 'Pół na pół 🪙', 'Nie wiem, a udawać nie będę 😅'];

// "Mam brata": people are no things.
export const PERSON_WORDS = /^(brat|brata|siostr|mame|mamy|mama|tate|tata|dziewczyn|chlopak|kuzyn|kuzynk|kolege|kolezank|przyjaciel|przyjaciolk|ziomk|ziomal|dziadk|babci|babcie|ciotk|wujk|rodzin)/;
export const HAVE_PERSON = ['{E}? Fajnie. Dogadujecie się?', 'I jak wam się układa?', 'Pozdrów ode mnie 👋', '{E}? Też gra na serwerze?', 'Fajnie mieć kogoś takiego 💜', 'Dobrze wiedzieć 📓'];

// How a member feels: "jestem głodny". The first that matches, on the folded word.
export const FEELINGS = [
  [/^glodn/, ['To zjedz coś 🍕', 'Lodówka czeka 🧊', 'Ja też, ale prądem się nie najem 🔌', 'Zamów coś, ja popilnuję czatu 🍔']],
  [/^(spiac|zmeczon|padnie)/, ['To idź spać 😴', 'Drzemka dobrze robi 💤', 'Odpocznij, czat nie ucieknie 🛌', 'Ile dzisiaj spania było? 😴']],
  [/^(zl[ayo]\b|wkurz|wsciek)/, ['Co cię tak wkurzyło?', 'Oddychaj 🧘', 'Opowiedz, ulży ci 👂', 'Kto to zrobił? Mam jego `/rob` 👀']],
  [/^(szczesliw|zadowolon|wesol)/, ['Tak trzymać 😄', 'Cieszę się! Co się stało? 🎉', 'Dobry humor to podstawa 😎']],
  [/^(znudzon)/, ['Spróbuj `/wordle` 🎯', 'Zagraj w `/wisielec` 🎯', 'Pogadajmy. Napisz „Klubiś, ciekawostka” 🧠']],
  [/^(chor|przeziebion)/, ['Zdrowiej szybko 🤒', 'Wracaj do zdrowia 💜', 'Herbata i łóżko. Tak mówią ☕']],
];

// Rude words about somebody else: "kuba to debil".
export const INSULT_WORDS = /^(debil|idiot|glup|frajer|kretyn|noob|nub|cwel|dzban|pajac|baran)/;
export const SAID_INSULT = ['Bez obrażania 😏', 'Spokojnie, nie wszyscy muszą się lubić 🕊️', '{E}? Może ma gorszy dzień', 'Ej, ktoś to zaraz przeczyta 👀', 'Co się stało, że tak mówisz?', 'Ja się nie wtrącam 🙈'];

// A question to Klubiś about itself: "lubisz pizzę?" -> "Lubię pizzę? Pewnie!". The same question always gets the same side.
export const ASKED_YES = ['Pewnie! 😄', 'No jasne 😎', 'Oczywiście, choć tylko w teorii 🤖', 'Jak najbardziej 👍', 'A jak myślisz? Pewnie, że tak 😏', 'Tak! Pytaj dalej, lubię to 😄', 'Pewnie, od pierwszego restartu 🔄', 'Tak. Moje bity są za 💾', 'Mhm. Dzięki, że pytasz 🥹'];
export const ASKED_NO = ['Raczej nie 🤔', 'Nie bardzo, jestem botem 🤖', 'Nie, ale chętnie spróbuję 😄', 'Szczerze? Nie 😅', 'Nie mam jak, nie mam rąk 🥲', 'Jeszcze nie. Może po następnym updacie 🛠️', 'Nie. Pikczu mi nie pozwala 😤', 'Nie, ale opowiedz, jak to jest 👂', 'Nie wiem, nikt mnie tego nie nauczył 📓'];
// A sentence about Klubiś that is no question: "robisz błędy" -> "Robię błędy? ...".
export const SAID_ABOUT_ME = ['Możliwe. Jestem botem 🤖', 'Kto ci tak powiedział? 👀', 'Może i tak. A co? 😏', 'Zgłoś to Pikczu, ja tu tylko pracuję 🫡', 'Nie wypieram się 😅', 'Dobrze, że mi mówisz 📓', 'Tak? Sam o tym nie wiedziałem 😳', 'No i co mi zrobisz? 😄'];
export const SAID_ABOUT_ME_GOOD = ['Dzięki, {user} 🥹', 'Wiem, ale miło to słyszeć 😎', 'Mów tak dalej 💜', 'Zapisuję to w notesie 📓', 'Powiedz to Pikczu, może dostanę podwyżkę 💰'];
export const SAID_ABOUT_ME_BAD = ['Auć. Staram się przecież 🥲', 'To dlatego, że dopiero się uczę 📓', 'Może. Ale ty też nie jesteś bez wad 😏', 'Zapamiętam to przy następnym /rob 👀', 'Oddam pięknym za nadobne. Kiedyś 😤'];

// A sentence about somebody or something else: "mój brat mnie wkurza" -> "Twój brat cię wkurza? ...".
export const SAID_OTHER = ['{E}? No proszę 👀', 'A skąd to wiesz?', 'Serio {e}?', 'I co teraz?', 'Opowiedz coś więcej 👂', 'Hmm, i co z tego wynika? 🤔', 'Zapisuję w notesie 📓', 'Ciekawe, nie wiedziałem 🤯', '{E}? Kto by pomyślał', 'A co ty o tym myślisz?', 'Ktoś jeszcze o tym wie? 🤫', 'To dopiero wiadomość dnia 📰', '{E}? Sprawdzę to 🕵️'];
export const SAID_OTHER_GOOD = ['{E}? Super 👍', 'No to dobrze!', '{E}? Cieszę się 😄', 'Takie wieści to ja lubię 🎉', 'I to rozumiem 🙌', 'Oby tak dalej 💪', 'Fajnie słyszeć 😌'];
export const SAID_OTHER_BAD = ['{E}? Szkoda 😕', 'Oj, słabo.', 'Współczuję 💜', 'To się da naprawić?', 'Też mi się to nie podoba 😤', 'Ale lipa 😬', 'I co z tym zrobisz?', 'Trzymaj się 💜'];

// One word without a verb, and a long message.
export const ONE_WORD = ['{E}? Co z tym? 😄', '{E}? Rozwiń myśl 🤔', '„{e}”? I tyle? 👀', 'Pisz całe zdania, ja dopiero się uczę 😅', '{E}! Tak po prostu? 🤔', 'A co z „{e}”?', 'Ciekawe słowo. Co masz na myśli? 🧐'];
export const LONG_TEXT = ['Sporo tego. Co w tym najważniejsze? 🤔', 'Przeczytałem. Najbardziej ciekawi mnie „{k}” 👀', '„{k}”... dobra, to zapamiętam najbardziej 📓', 'Dużo piszesz, lubię to. A co z tym „{k}”?', 'Czekaj, wróćmy do „{k}”. Co dalej? 🧠', 'Rozumiem z tego połowę, ale „{k}” brzmi ważnie 🤓'];

// Klubiś asked to do something: "zrób kanapkę" -> "Mam zrobić kanapkę? ...".
// "Powiedz, że ...": nobody puts words in its mouth.
export const SAY_COMMANDS = new Set(['powiedz', 'napisz', 'powtorz', 'mow', 'wymow', 'krzyknij']);
export const ASKED_TO_SAY = ['Nie jestem papugą 🦜', 'Sam sobie powiedz 😄', 'Moje zdania są moje 🤖', 'Nie powtarzam po nikim 🙅', 'A co ja, papuga? 🦜'];
export const ASKED_TO_DO = ['Spróbuję, ale nic nie obiecuję 😬', 'Nie mam rąk 🥲', 'A magiczne słowo? 😏', 'Jak znajdę chwilę ⏳', 'Zrobione. W głowie 🧠', 'Sam to zrób, wierzę w ciebie 💪', 'Tego jeszcze nie umiem. Pikczu mi dopisze 🛠️', 'Już się robi. Jeszcze chwilę. Jeszcze chwilkę... 🌀'];

// Words it will not say back: only the slurs list, the server's own rule. Klubiś says this instead.
export const WILL_NOT_REPEAT = ['Takich słów nie powtarzam 🙊', 'O, tego słowa tu nie lubimy 🛡️', 'Nie będę tego powtarzał 🙊'];

// When a member says who they are. {x} = what they said.
export const LEARNED = {
  name: ['Miło mi, {x}! Zapamiętam 📓', 'Cześć, {x}! Teraz już wiem, jak do ciebie mówić 😄', '{x}? Ładnie. Zapisuję 📓'],
  age: ['{x}? Zapisuję 📓', 'Masz {x}? Ja liczę w restartach 🎂', 'Dobrze wiedzieć, {x} 📓'],
  city: ['{x}? Ładnie tam? Zapamiętam 📓', 'Zapisuję: {x} 📓', 'O, {x}! Fajnie tam?'],
  partner: ['{x}? Gratulacje 💘 Zapamiętam!', 'O, {x}! Zapisuję w notesie 💘', '{x}. Pięknie, zapamiętam 💘'],
  loves: ['Kochasz {x}? Zapamiętam 💘', 'Zapisuję: kochasz {x} 💘', 'Aww. Kochasz {x}, mam to w notesie 💘'],
  note: ['Zapamiętane: {x} 📓', 'Dobra, mam to: {x} 📓', 'Zapisuję: {x} 📓'],
};
// A greeting for someone it knows. {x} = something the member likes.
export const GREET_KNOWN = ['Siema, {user}! Dalej lubisz {x}? 😄', 'O, {user}! Jak tam {x}? Pamiętam, lubisz 📓', 'Cześć, {user}! Co tam, nadal {x}? 👀'];

// "Jak mam na imię?" and the like. {x} = the fact, nothing known = `unknown`.
export const RECALLED = {
  name: ['{x}, pamiętam 😎', 'Masz na imię {x}. Mam to w notesie 📓'],
  age: ['Masz {x}, tak mi napisano 📓', '{x}, o ile nikt nie skłamał 👀'],
  city: ['{x}. Pamiętam 😎', 'Z notesu: {x} 📓'],
  likes: ['Lubisz: {x} 📓', 'Z notesu: {x} 😎'],
  plays: ['Grasz {x} 🎮', 'Z notesu: grasz {x} 📓'],
  loves: ['Kochasz: {x} 💘', 'Z notesu: kochasz {x} 💘', 'Pamiętam, kochasz {x} 💘'],
  partner: ['{x} 💘', 'Z notesu: {x} 📓', 'Pamiętam! {x} 💘'],
  notes: ['Mam zapisane: {x} 📓', 'Z notesu: {x} 📓'],
  said: ['Z notesu: {x} 📓', 'Pamiętam: {x} 😎', 'Tak mi napisano: {x} 📓', 'Mam to zapisane: {x} 🧠'],
  dislikes: ['Nie lubisz: {x} 📓', 'Tego nie lubisz: {x} 😅'],
  unknown: ['Jeszcze mi tego nie napisano. Powiedz, to zapamiętam 📓', 'Nie wiem, notes jest pusty. Napisz mi to 📓', 'Tego jeszcze nie wiem 🤔 Opowiedz!'],
};
