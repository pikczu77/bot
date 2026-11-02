// klubisServer.js — questions about the server itself, answered from what the server really has (2026-11-02, owner: "wiecej odmian pytan
// o boosty, kanal itp. ciezko sie wstrzelic", then "wiecej odmian waznych pytan"): the boost perks set in the panel, channels found by their
// names, the moderators, the warning ladder, the level roles, the Minecraft whitelist. Members ask these in many ways and mostly without "?",
// so the patterns are wide. Returns null when the message is not such a question or the data is not there; the skills still answer then.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { fold, plural } from './klubisBrain.js';
import { PACKS } from './collections.js';
import { getEconomySettings, money } from './economySettings.js';
import { REWARD_EVERY_DAYS, perksOn } from './serverBoost.js';
import { getPunishmentSettings } from './moderation/warningPunishments.js';
import { getLevelingConfig } from './leveling/leveling.js';
import { getWhitelistConfig } from './minecraftWhitelist.js';
import { getGuildGiveaways } from '../utils/giveaways.js';
import { VIDEOS } from '../config/klubisKnowledgeData.js';

const TIME_ZONE = 'Europe/Warsaw';
const MAX_CHANNELS = 3;
const MAX_PEOPLE = 8;
const MAX_RANKS = 8;
const SHORT_WORDS = 6;

// A question also without "?" (`text` is folded, so the "?" is checked on the raw message).
const ASKS = /^(a |no |ej |i |to |a jak )?(czy|jak|gdzie|skad|kiedy|ile|po ilu|po ile|co|kto|kogo|komu|czemu|dlaczego|po co|za co|jaki\w*|jaka|jakie|ktor\w*|o ktorej|bedzie|beda|mozna|moge|da sie|oplaca sie|warto|macie|jest|sa)\b/;

// ---- Boost
const BOOST = /\b(z?boost\w*|z?bust\w*|nitro\w*)\b/;
const POTIONS = /\b(potk\w*|mikstur\w*|x2)\b/;
const BOOSTED = /\b(dal(em|am)|wrzucil(em|am)|kupil(em|am)|zrobil(em|am)) (ci |wam |serwerowi )?(boost\w*|bust\w*)\b|\bz?boostowal(em|am)\b|\bzbustowal(em|am)\b/;
const BOOST_ME = /\b(czy )?(ja )?(boostuje|mam boost\w*)\b|\bmoj\w* boost\w*\b/;
const BOOST_WHO = /\bkto\b/;
const BOOST_COST = /\b(ile kosztuj\w*|cen\w*|koszt\w*|za ile|ile plac\w*|ile zl|ile trzeba zaplacic)\b/;
const BOOST_COUNT = /\b(ile|poziom\w*|level\w*|lvl|tier\w*)\b/;
const BOOST_PERKS = /\b(co|jakie|jaka|nagrod\w*|dostan\w*|dostaje\w*|dostac|daje|dają|oplaca\w*|warto|z tego|mam z|bonus\w*|korzysc\w*|plus\w*)\b/;
const BOOST_HOW = /\bjak\b|\bgdzie\b/;
// "Lubię boostować w grach", "mój boost w grze się skończył": not the server's boost.
const BOOST_ELSEWHERE = /\bw (grze|grach|minecraft\w*|fortnit\w*|roblox\w*|cs\w*|lolu?|valorant\w*)\b|\b(lubie|kocham|gram|grasz)\b/;

// ---- Channels, found by their names. `ask` reads the question, `names` are beginnings of words in a channel's name.
const WHERE = /\bgdzie\b|\b(na|w) (jakim|ktorym) kanale\b|\b(jaki|ktory) (jest )?kanal\b|\blink do kanalu\b|\bjak (wybrac|wziac|dostac|zdobyc|odebrac) (sobie )?(role|rangi|kolor\w*)\b|\bjak (dac|dodac|napisac|wyslac|wrzucic|zglosic) (swoj\w* )?(propozycj|pomysl|sugesti)\w*/;
const TOPICS = [
  { ask: /\b(regulamin\w*|zasad\w*|rules)\b/, names: ['regulamin', 'zasad', 'rules', 'regul'], label: 'Regulamin', emoji: '📜' },
  { ask: /\b(ticket\w*|tiket\w*|zglos\w*|zglasza\w*|skarg\w*|support\w*|pomoc\w*)\b/, names: ['ticket', 'tiket', 'zglosz', 'support', 'pomoc', 'kontakt'], label: 'Tickety', emoji: '🎫' },
  { ask: /\b(propozycj\w*|sugesti\w*|pomysl\w*)\b/, names: ['propozycj', 'sugest', 'pomysl'], label: 'Propozycje', emoji: '💡' },
  { ask: /\b(fan ?art\w*|arty?|rysun\w*|rysowa\w*|obraz\w*|grafik\w*|tworczos\w*)\b/, names: ['fan', 'art', 'rysun', 'tworczos', 'grafik', 'obrazk'], label: 'Fan arty', emoji: '🎨' },
  { ask: /\bmem\w*\b/, names: ['mem'], label: 'Memy', emoji: '😂' },
  { ask: /\b(zdjec\w*|fot\w*|screen\w*|klip\w*|clip\w*|media)\b/, names: ['zdjec', 'foto', 'fotk', 'screen', 'media', 'klip', 'clip'], label: 'Media', emoji: '📸' },
  { ask: /\b(ogloszen\w*|news\w*|nowosci)\b/, names: ['oglosz', 'announce', 'news', 'nowosci'], label: 'Ogłoszenia', emoji: '📢' },
  { ask: /\b(film\w*|odcin\w*|youtube\w*|yt|powiadom\w*)\b/, names: ['film', 'youtube', 'yt', 'powiadom', 'odcin'], label: 'Filmy', emoji: '🎥' },
  { ask: /\b(giveaway\w*|konkurs\w*|losowan\w*)\b/, names: ['giveaway', 'konkurs', 'losowan'], label: 'Konkursy', emoji: '🎉' },
  { ask: /\bevent\w*\b/, names: ['event'], label: 'Eventy', emoji: '🎉' },
  { ask: /\bz?boost\w*\b/, names: ['boost'], label: 'Boosty', emoji: '💎' },
  { ask: /\b(komend\w*|komand\w*|bot\w*|cmd)\b/, names: ['komend', 'bot', 'command', 'cmd'], label: 'Komendy', emoji: '🤖' },
  { ask: /\b(rol[aeiy]?|rang\w*|kolor\w*)\b/, names: ['role', 'rola', 'rangi', 'roles', 'kolor', 'autorol'], label: 'Role', emoji: '🎭' },
  { ask: /\b(powitan\w*|witaj\w*|welcome)\b/, names: ['powitan', 'witaj', 'welcome'], label: 'Powitania', emoji: '👋' },
  { ask: /\b(level\w*|poziom\w*|lvl)\b/, names: ['level', 'poziom', 'lvl'], label: 'Poziomy', emoji: '⭐' },
  { ask: /\b(kasyn\w*|ekonomi\w*|gambl\w*|hazard\w*)\b/, names: ['kasyn', 'casino', 'ekonom', 'gambl', 'hazard'], label: 'Ekonomia', emoji: '🎰' },
  { ask: /\b(minecraft\w*|majnkraft\w*|mc|smp)\b/, names: ['minecraft', 'mc', 'smp'], label: 'Minecraft', emoji: '⛏️' },
  { ask: /\b(muzyk\w*|music|nutk\w*)\b/, names: ['muzyk', 'music'], label: 'Muzyka', emoji: '🎵' },
  { ask: /\b(liczeni\w*|liczyc)\b/, names: ['liczen', 'count'], label: 'Liczenie', emoji: '🔢' },
  { ask: /\b(czat\w*|chat\w*|pisac|pisze\w*|gadac|gadacie|pogadac|rozmawia\w*|glown\w*|ogoln\w*|general\w*)\b/, names: ['czat', 'chat', 'general', 'ogoln', 'glown', 'pogaduch', 'rozmow'], label: 'Czat', emoji: '💬' },
];
const OWN_VOICE = /\b(swoj\w*|wlasn\w*|prywatn\w*) (kanal\w*|vc|pokoj\w*|glosow\w*)\b|\b(kanal\w*|pokoj\w*) glosow\w*\b|\bvc\b/;
const MAKE = /\bjak (zrobic|stworzyc|zalozyc|miec|dostac|zrobic sobie)\b/;
const HUB_NAMES = ['stworz', 'utworz', 'zaloz', 'create', 'nowy', 'dolacz'];
const NAMED_CHANNEL = /\bkanal\w* (?:(?:z|do|od|na|dla|o) )?([a-z0-9]{3,})/;
const NOT_NAMES = new Set(['jest', 'tutaj', 'ten', 'ktory', 'taki', 'jakis', 'glosowy']);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);

// ---- Staff, reports, warnings, rules
const REPORT = /\bktos (mnie |tu |na czacie |ciagle |caly czas )?(obraza|wyzywa|spamuje|hejtuje|neka|grozi|przesladuje|trolluje|reklamuje|oszukal\w*|okradl\w*|scamuje|zaczepia|dokucza)\b/;
const APPEAL = /\bodwol\w*\b|\bniesluszn\w*\b/;
const CONTACT = /\b(napisac|pisac|skontaktowac|kontakt\w*|zawolac|wolac)\b.*\b(admin\w*|mod|moda|modow|modzi|moderator\w*|administracj\w*|ekip\w*|staff\w*|wlasciciel\w*|helper\w*)\b|\b(jak|gdzie)\b.*\b(zglosic|zglaszac|zgloszeni\w*|skarg\w*)\b/;
const WHO_STAFF = /\bkto (tu |tutaj )?(jest|sa|to)\b.*\b(admin\w*|mod|modem|modami|moderator\w*|administracj\w*|ekip\w*|staff\w*|helper\w*)\b|\bkto (tu |tutaj )?(rzadzi|moderuje|pilnuje)\b|\b(lista|jaka jest) (adminow|modow|ekipy|administracji)\b/;
const BECOME_STAFF = /\bjak (zostac|byc|dostac|zdobyc)\b.*\b(mod|modem|moda|moderator\w*|admin\w*|helper\w*|administracj\w*|ekip\w*|staff\w*)\b|\brekrutacj\w*\b|\bszukacie (mod|admin|helper|moderator)\w*\b|\bpodani\w*\b.*\b(mod|admin|helper|ekip|moderator)\w*\b|\bchce (byc|zostac) (mod|admin|helper|moderator)\w*\b/;
const WHY_PUNISHED = /\bza co\b.*\b(ban\w*|warn\w*|ostrzezen\w*|kick\w*|mute\w*|wycisz\w*|timeout\w*|kar[aey]?)\b/;
const WARNINGS_TO = /\bile\b.*\b(warn\w*|ostrzezen\w*)\b.*\b(do|na|za|i|dla) (bana|kicka|mute\w*|wyciszeni\w*|timeout\w*|kary)\b|\bpo ilu\b.*\b(warn\w*|ostrzezen\w*)\b/;
const WARNING_GONE = /\b(jak|da sie|mozna|kiedy)\b.*\b(zdjac|usunac|skasowac|pozbyc|zbic|wyczyscic|znik\w*|zejd\w*|schodz\w*|minie|mina|wygas\w*)\b.*\b(warn\w*|ostrzezen\w*)\b|\b(warn\w*|ostrzezen\w*)\b.*\b(znik\w*|schodz\w*|zejd\w*|minie|mina|wygas\w*)\b/;
const MAY = /\b(mozna|wolno|moge|da sie)\b/;
const RULE_THINGS = /\b(przeklin\w*|kln\w*|wyzyw\w*|obraza\w*|spam\w*|reklam\w*|link\w*|nsfw|porn\w*|caps\w*|pingowa\w*|oznacza\w*|handlowa\w*|sprzeda\w*|multikont\w*|trollowa\w*|flood\w*)\b/;

// ---- Ranks, Minecraft, invites, money
const RANKS = /\b(jak|gdzie|za co|kiedy|skad)\b.*\brang\w*\b|\bjakie (sa )?rangi\b|\brangi za\b|\bjak (dostac|zdobyc|miec|wbic) (wyzsz\w* )?(role|range)\b/;
const MC_SERVER = /\b(serwer\w*|server\w*)\b.*\b(minecraft\w*|majnkraft\w*|mc)\b|\b(minecraft\w*|majnkraft\w*|mc)\b.*\b(serwer\w*|server\w*)\b|\bjak (wejsc|dolaczyc|grac|zagrac)\b.*\b(minecraft\w*|majnkraft\w*|mc)\b|\bwhitelist\w*\b/;
const SMP_WHO = /\bsmp\b/;
const SMP_PEOPLE = /\b(kto|jacy|ktorzy|ile osob|lista|sklad)\b/;
const INVITE = /\b(zapros\w*|zaproszen\w*|invite\w*)\b|\blink\w* (do|na|z) (serwer\w*|discord\w*|dc)\b/;
const PLAY_MUSIC = /\b(pusc|puszczaj|wlacz|zagraj)\b.*\b(muzyk\w*|piosenk\w*|nutk\w*|kawal\w*|utwor\w*|rap\w*|disco)\b/;
const EARN = /\b(jak|gdzie|czym|skad|co)\b.*\b(zarob\w*|zarabia\w*|zdoby\w*|dosta\w*|zgarn\w*|wbi\w*|miec|zebrac)\b.*\b(kas[aeyi]|kase|kasy|hajs\w*|pieniad\w*|pieniedz\w*|monet\w*|kask\w*|siana|money|dolar\w*)\b|\bjak (szybko |najszybciej |latwo )?(zarobic|zarabiac)\b/;

// ---- Common questions with one right answer: a random line of a topic often missed them ("jak dziala bank" got the stock market).
// [question, answer]; the answer may be a function (message) => line. Checked after the answers from data, only for a question.
const ruleChannel = (message) => {
  const [rules] = topicChannels(message, 'Regulamin');
  return rules ? channelLink(rules) : 'kanale z regulaminem';
};
const QA = [
  [/\b(jak|po co|co|czy)\b.*\bbank\w*\b|\bjak (wplacic|wyplacic|schowac)\b/,
    '`/bank wplac` chowa kasę przed `/rob`, `/bank wyplac` ją wyjmuje. Bank nie płaci odsetek 🏦'],
  [/\bjak\b.*\b(ochroni\w*|chroni\w*|zabezpiecz\w*|uchroni\w*|obroni\w*)\b.*\b(rob(a|em|ie|y|u|owaniem)?|kradziez\w*|okradani\w*|zlodziej\w*|kas[aeyi]|kase)\b/,
    '`/bank wplac` chowa kasę, a „Ochrona banku” w `/ulepszenia` zmniejsza, ile `/rob` zabiera z banku 🛡️'],
  [/\b(jak|czy)\b.*\b(okras\w*|ukras\w*|obrabow\w*|krasc|okradac|okrada\w*|rob(a|em|ie|y|u)?|robowa\w*)\b/,
    '`/rob @ktoś` zabiera 80% portfela i 50% banku 🦹 Przed nim chroni `/bank wplac` i „Ochrona banku” w `/ulepszenia`.'],
  [/\b(jak|gdzie|skad)\b.*\b(zdoby\w*|dosta\w*|kupi\w*|zebra\w*|miec|bra\w*|wzia\w*)\b.*\bkart\w*\b/,
    'Karty są w paczkach: `/paczka` 📦 Kolekcja: `/index`, pięć takich samych połączysz w `/polacz`.'],
  [/\bco (mozna|moge|da sie) (tu )?kupic\b|\bco jest w sklepie\b|\bgdzie (jest )?sklep\b/,
    '`/sklep` ma narzędzia i przedmioty, `/ulepszenia` stałe bonusy, `/paczka` karty, `/boosty` potki x2 🛒'],
  [/\bjak (dziala|grac w|ogarnac) (ta |tu )?ekonomi\w*\b|\bo co chodzi w ekonomii\b/, (message) => {
    const [guide] = topicChannels(message, 'Ekonomia');
    return `Zarabiasz: \`/work\`, \`/daily\`, \`/nagraj\`, \`/fish\`. Chowasz w \`/bank\`, wydajesz w \`/sklep\` i \`/ulepszenia\`, ryzykujesz w kasynie 💰${guide ? ` Poradnik: ${channelLink(guide)}` : ''}`;
  }],
  [/\b(jak|skad|gdzie)\b.*\b(zdoby\w*|dosta\w*|zebra\w*|zbiera\w*|miec)\b.*\b(cukier\w*|pierni\w*|pisan\w*|walut\w*|muszl\w*|lizak\w*)\b/,
    'Walutę eventu dostajesz za pisanie na czacie, prace, gierki i dropy, a codzienną porcję daje `/event zbierz` 🍬 Sklep: `/event sklep`'],
  [/\bco (daje|daja|da) (wysoki |wyzszy )?(poziom|level|lvl)\w*\b|\bpo co (mi )?(poziom|level|lvl)\w*\b/,
    'Wyższy poziom to lepsze prace w `/work`, kasa za każdy level i rangi za poziomy ⭐'],
  [/\bjak (szybko |szybciej )?awans\w*\b|\b(jak|skad|za co|czym)\b(?!.*\bsprawdz\w*).*\b(xp|expa?|poziom\w*|level\w*|lvl)\b/,
    'XP leci za pisanie na czacie i rozmowy na głosowym ⭐ Szybciej: `/boosty` (x2 XP) i boost serwera. Spam nic nie daje.'],
  [/\bjak\b.*\b(wygrac|wziac udzial|zapisac|dolaczyc|wejsc)\b.*\b(konkurs\w*|giveaway\w*|losowani\w*)\b/,
    'Kliknij przycisk pod konkursem i czekaj na losowanie 🎉 Jeśli konkurs ma wymagania (poziom, rola), są napisane w nim.'],
  [/\bjak\b.*\b(wejsc|dolaczyc|wbic|gadac)\b.*\b(vc|glosow\w*|kanal glosowy)\b/, (message) => {
    const [hub] = findChannels(message, HUB_NAMES, { voice: true });
    return `Kliknij kanał głosowy na liście kanałów i już jesteś 🔊${hub ? ` Własny kanał zrobi ci ${channelLink(hub)}.` : ''}`;
  }],
  [/\b(kiedy|o ktorej|bedzie|jest)\b.*\b(live\w*|lajw\w*|stream\w*|transmisj\w*)\b/,
    'Live’y Pikczu ogłasza na YouTube, włącz dzwoneczek: <https://youtube.com/@Pikczu77> 🔔'],
  [/^(a |no )?co (ty )?(umiesz|potrafisz)( robic| zrobic)?$/,
    'Odpowiadam na pytania o serwer: kasa, poziomy, boost, kanały, kary 🤖 Pamiętam, co o sobie piszesz, rzucam kostką, przypominam i liczę. Komendy: `/komendy`'],
  [/\bjakie (sa |masz |tu )?(komendy|polecenia)\b|\bjak (uzywac|korzystac z|uzyc) (bota|komend)\b|\bco (sie )?(tu |tutaj )(sie )?robi\b|\bco (tu |tutaj )?(mozna|da sie) (tu |tutaj )?(robic|porobic)\b/,
    'Wszystkie komendy pokaże `/komendy` 📋 Na start: `/daily`, `/work`, `/profil`, a dla zabawy `/wordle` i `/paczka`.'],
  [/\bjakie (sa )?(tu )?(zasady|reguly)\b|\bco (jest )?(zakazane|zabronione)\b|\bczego nie (wolno|mozna)\b/,
    (message) => `Zasady są na ${ruleChannel(message)} 📜 W skrócie: bez wyzwisk, spamu i reklam.`],
  [/\bco nowego\b.*\b(bot\w*|klubis\w*|serwer\w*|dc|discord\w*)\b|\bjakie (sa )?nowosci\b|\bco (nowego )?(dodaliscie|dodales|dodal|zmieniliscie|zmieniles)\b/, (message) => {
    const [news] = topicChannels(message, 'Ogłoszenia');
    return `Nowości ogłasza ekipa${news ? ` na ${channelLink(news)}` : ''} 📢 A ja dostaję nowe rzeczy prawie codziennie 🛠️`;
  }],
];
// Said, not asked: "jestem nowy".
const NEWCOMER = /\bjestem (tu |tutaj )?(nowy|nowa)( tu| tutaj| na serwerze| na tym serwerze)?$|\bpierwszy raz (tu|tutaj|na serwerze|jestem)\b|\bjak (tu )?zaczac\b|\bod czego zaczac\b/;
const GIVEAWAY_WHEN = /\b(kiedy|bedzie|beda|jest|sa|trwa|macie)\b.*\b(giveaway\w*|konkurs\w*|losowani\w*)\b/;
const IN_VOICE = /\bkto\b.*\b(vc|glosow\w*|kanale glosowym)\b|\bile (osob|ludzi)\b.*\b(vc|glosow\w*)\b/;
const VIDEO_WHEN = /\b(kiedy|o ktorej|bedzie)\b.*\b(film\w*|odcin\w*|filmik\w*)\b/;

async function questionAnswer(message, text) {
  const { guild, client } = message;
  if (GIVEAWAY_WHEN.test(text) && !/\bjak\b/.test(text)) {
    const all = await getGuildGiveaways(client, guild.id).catch(() => []);
    const running = all.filter((giveaway) => giveaway.ended !== true && giveaway.isEnded !== true);
    if (running.length) {
      const next = running.sort((a, b) => Number(a.endsAt ?? a.endTime ?? 0) - Number(b.endsAt ?? b.endTime ?? 0))[0];
      const ends = Number(next.endsAt ?? next.endTime);
      return `Trwa konkurs: ${next.prize}${next.channelId ? ` na ${channelLink({ id: next.channelId })}` : ''}${ends ? `, koniec <t:${Math.floor(ends / 1000)}:R>` : ''} 🎉`;
    }
    const [news] = topicChannels(message, 'Ogłoszenia');
    return `Teraz żadnego konkursu nie ma. Nowy pojawi się${news ? ` na ${channelLink(news)}` : ' na ogłoszeniach'} 🎁`;
  }
  if (IN_VOICE.test(text)) {
    const rooms = new Map();
    for (const state of guild.voiceStates?.cache?.values?.() ?? []) {
      if (!state.channelId || state.member?.user?.bot) continue;
      const channel = guild.channels?.cache?.get?.(state.channelId);
      if (!channel || channel.permissionsFor?.(message.member)?.has?.(PermissionFlagsBits.ViewChannel) === false) continue;
      rooms.set(channel.id, (rooms.get(channel.id) ?? 0) + 1);
    }
    if (!rooms.size) return 'Teraz nikt nie siedzi na głosowym 🔇 Wejdź pierwszy!';
    const list = [...rooms].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHANNELS);
    return `Na głosowych: ${list.map(([id, count]) => `${channelLink({ id })} (${count} ${plural(count, 'osoba', 'osoby', 'osób')})`).join(', ')} 🔊`;
  }
  if (VIDEO_WHEN.test(text) && VIDEOS.latest?.[0]) {
    return `Daty nowego filmu nie znam, Pikczu jej nie zdradza 🤐 Ostatni: „${VIDEOS.latest[0].title}” <https://youtu.be/${VIDEOS.latest[0].id}>`;
  }
  for (const [question, answer] of QA) if (question.test(text)) return typeof answer === 'function' ? answer(message) : answer;
  return null;
}

// ---- Pikczu: a real person, so a yes/no about him is never a coin toss.
const ABOUT_PIKCZU = /\bczy\b.*\bpikcz\w*\b|\bpikcz\w*\b.*\bczy\b/;
const PIKCZU_HERE = /\b(odpis\w*|odpowi\w*|czyta\w*|przeczyt\w*|widzi|zobaczy|bywa|siedzi|wchodzi|zaglada|online|aktywny)\b|\b(jest|pisze) (tu|tutaj|na serwerze|na dc|na discordzie)\b|\b(tu|tutaj) (jest|pisze)\b/;

const channelLink = (channel) => `<#${channel.id}>`;
const dateOf = (value) => new Date(value).toLocaleDateString('pl-PL', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' });

/** Channels the member can see whose name has a word starting with one of the stems. */
export function findChannels(message, stems, { voice = false } = {}) {
  const found = [];
  for (const channel of message.guild.channels?.cache?.values?.() ?? []) {
    if (voice ? channel.type !== ChannelType.GuildVoice : !TEXT_TYPES.has(channel.type)) continue;
    if (message.member && channel.permissionsFor?.(message.member)?.has?.(PermissionFlagsBits.ViewChannel) === false) continue;
    const name = String(channel.name ?? '');
    const words = fold(name).split(' ').filter(Boolean);
    if (stems.some((stem) => (stem === '+' ? /[+➕]/.test(name) : words.some((word) => word.startsWith(stem))))) found.push(channel);
  }
  return found.sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0)).slice(0, MAX_CHANNELS);
}

const topicChannels = (message, label) => findChannels(message, TOPICS.find((topic) => topic.label === label).names);
const ticketPlace = (message) => {
  const [channel] = topicChannels(message, 'Tickety');
  return channel ? ` na ${channelLink(channel)}` : ' przyciskiem na kanale z ticketami';
};

async function boostAnswer(message, text, asks) {
  const { guild } = message;
  if (POTIONS.test(text)) return 'Potki x2 to `/boosty`, a nagrody za boost serwera: `/booster info` ⚡';
  if (BOOSTED.test(text)) return 'Dzięki za boosta 💜 Nagrody przyjdą same, najpóźniej po 10 minutach. Status: `/booster info`';
  if (BOOST_ELSEWHERE.test(text)) return null;
  if (!asks && text.split(' ').length > SHORT_WORDS) return null;
  if (BOOST_WHO.test(text) && !BOOST_ME.test(text.replace(/\bboostuje\b/, ''))) {
    const boosters = [...(guild.members?.cache?.values?.() ?? [])].filter((member) => member.premiumSince && !member.user?.bot).slice(0, MAX_PEOPLE);
    if (boosters.length) return `Boostują: ${boosters.map((member) => `<@${member.id}>`).join(', ')} 💎 Dzięki im!`;
    const count = guild.premiumSubscriptionCount ?? 0;
    return count ? `Serwer ma ${count} ${plural(count, 'boost', 'boosty', 'boostów')}, ale listy osób nie widzę 💎` : 'Nikt teraz nie boostuje. Możesz być pierwszy 💎';
  }
  if (BOOST_ME.test(text)) {
    const since = message.member?.premiumSince;
    return since ? `Boostujesz od ${dateOf(since)} 💎 Dzięki! Twoje nagrody: \`/booster info\`` : 'Teraz nie boostujesz. Co daje boost: `/booster info` 💎';
  }
  if (BOOST_COST.test(text)) return 'Boost kupujesz w Discordzie: Nitro ma w cenie 2 boosty, sam boost też da się dokupić. Cenę pokaże Discord przy „Boost serwera” 💎';
  if (BOOST_COUNT.test(text) && !BOOST_PERKS.test(text) && Number.isInteger(guild.premiumSubscriptionCount)) {
    const count = guild.premiumSubscriptionCount;
    return `Serwer ma ${count} ${plural(count, 'boost', 'boosty', 'boostów')} i poziom ${guild.premiumTier ?? 0} 💎`;
  }
  if (BOOST_HOW.test(text) && !BOOST_PERKS.test(text)) {
    return 'Kliknij nazwę serwera nad listą kanałów, potem „Boost serwera” 💎 Boosty są w Nitro albo kupujesz je osobno. Nagrody przyjdą same.';
  }
  const settings = await getEconomySettings(guild.id);
  if (!perksOn(settings)) return 'Nagrody za boost są tu wyłączone. Boost i tak daje serwerowi więcej emoji i lepszy dźwięk na głosowych 💜';
  const boost = settings.serverBoost;
  const pack = PACKS.find((item) => item.id === boost.pack);
  const reward = [boost.cashReward > 0 ? money(guild.id, boost.cashReward) : null, pack ? `${pack.emoji} paczka kart` : null].filter(Boolean).join(' + ');
  const perks = [
    reward ? `${reward} od razu i co ${REWARD_EVERY_DAYS} dni` : null,
    boost.moneyPercent > 0 ? `+${boost.moneyPercent}% do każdej wypłaty` : null,
    boost.xpPercent > 0 ? `+${boost.xpPercent}% XP` : null,
    boost.eventMinutes > 0 ? `${boost.eventMinutes} min podwójnej kasy dla wszystkich` : null,
    'dwie odznaki',
  ].filter(Boolean);
  return `Za boost dostajesz: ${perks.join(', ')} 💎 Wszystko: \`/booster info\``;
}

function channelAnswer(message, text) {
  if ((WHERE.test(text) || MAKE.test(text)) && OWN_VOICE.test(text)) {
    const [hub] = [...findChannels(message, HUB_NAMES, { voice: true }), ...findChannels(message, ['+'], { voice: true })];
    if (hub) return `Wejdź na ${channelLink(hub)}, bot zrobi ci własny kanał 🔊`;
    const voice = findChannels(message, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'w', 'z', 'v'], { voice: true });
    return voice.length ? `Kanały głosowe: ${voice.map(channelLink).join(', ')} 🔊` : null;
  }
  if (!WHERE.test(text)) return null;
  const topic = TOPICS.find((item) => item.ask.test(text));
  if (topic) {
    const found = findChannels(message, topic.names);
    if (found.length) return `${topic.label}: ${found.map(channelLink).join(', ')} ${topic.emoji}`;
  }
  const named = NAMED_CHANNEL.exec(text)?.[1];
  if (named && !NOT_NAMES.has(named)) {
    const found = findChannels(message, [named.slice(0, 5)]);
    if (found.length) return `Proszę: ${found.map(channelLink).join(', ')} 📍`;
  }
  return null;
}

function durationOf(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} godz.`;
  const days = Math.round(minutes / 1440);
  return `${days} ${plural(days, 'dzień', 'dni', 'dni')}`;
}

/** "3 = wyciszenie na 10 min, 10 = kick, 12 = ban na 7 dni", from the panel's ladder. */
async function ladderLine(guildId) {
  const settings = await getPunishmentSettings(guildId);
  if (settings.enabled === false) return 'Kary za ostrzeżenia daje tu ekipa sama.';
  const steps = [...(settings.steps ?? [])].sort((a, b) => a.count - b.count);
  const pick = (action) => steps.find((step) => step.action === action);
  const parts = [
    pick('timeout') && `${pick('timeout').count} = wyciszenie na ${durationOf(pick('timeout').minutes)}`,
    pick('kick') && `${pick('kick').count} = kick`,
    pick('ban') && `${pick('ban').count} = ban${pick('ban').minutes ? ` na ${durationOf(pick('ban').minutes)}` : ''}`,
  ].filter(Boolean);
  const days = Number(settings.expireDays) || 0;
  const counted = days ? `Ostrzeżenia liczą się ${days} ${plural(days, 'dzień', 'dni', 'dni')}` : 'Ostrzeżenia się nie przedawniają';
  return parts.length ? `${counted}: ${parts.join(', ')} 🚨` : `${counted} 🚨`;
}

async function staffAnswer(message, text, asks) {
  if (REPORT.test(text)) return `Zrób screena i otwórz ticket${ticketPlace(message)}, ekipa się tym zajmie 🎫 Możesz też tę osobę zablokować.`;
  if (BECOME_STAFF.test(text)) {
    const [news] = topicChannels(message, 'Ogłoszenia');
    return `Ekipę wybiera właściciel serwera 👮 Jak ruszy rekrutacja, będzie ${news ? `na ${channelLink(news)}` : 'na ogłoszeniach'}. Najlepiej być aktywnym i miłym na czacie.`;
  }
  if (!asks) return null;
  if (APPEAL.test(text)) return `Odwołanie: otwórz ticket${ticketPlace(message)} i spokojnie opisz, co się stało 🎫`;
  if (WARNING_GONE.test(text)) {
    const days = Number((await getPunishmentSettings(message.guild.id)).expireDays) || 0;
    const gone = days ? `Ostrzeżenie znika samo po ${days} ${plural(days, 'dniu', 'dniach', 'dniach')}.` : 'Ostrzeżenia tu same nie znikają.';
    return `${gone} Niesłuszne? Ticket${ticketPlace(message)} 🎫`;
  }
  if (WHY_PUNISHED.test(text)) {
    const [rules] = topicChannels(message, 'Regulamin');
    return `Za łamanie regulaminu${rules ? ` (${channelLink(rules)})` : ''} 📜 ${await ladderLine(message.guild.id)}`;
  }
  if (WARNINGS_TO.test(text)) return ladderLine(message.guild.id);
  if (MAY.test(text) && RULE_THINGS.test(text)) {
    const [rules] = topicChannels(message, 'Regulamin');
    return `Lepiej nie 😅 Co wolno, a czego nie: ${rules ? channelLink(rules) : 'regulamin'} 📜`;
  }
  if (WHO_STAFF.test(text)) {
    const staff = [...(message.guild.members?.cache?.values?.() ?? [])]
      .filter((member) => !member.user?.bot && member.permissions?.any?.([PermissionFlagsBits.Administrator, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages]))
      .slice(0, MAX_PEOPLE);
    return staff.length ? `Ekipa, którą widzę: ${staff.map((member) => `<@${member.id}>`).join(', ')} 👮` : 'Ekipę widać na liście członków po prawej, na samej górze 👮';
  }
  if (CONTACT.test(text)) return `Do ekipy najlepiej przez ticket${ticketPlace(message)} 🎫`;
  return null;
}

async function otherAnswer(message, text, asks) {
  const { guild, client } = message;
  if (INVITE.test(text) && (asks || /\bdaj\b/.test(text))) {
    if (guild.vanityURLCode) return `Link do serwera: <https://discord.gg/${guild.vanityURLCode}> 📨`;
    if (/\bzapros\w*\b/.test(text)) return 'Kliknij nazwę serwera na górze, potem „Zaproś ludzi”, i wyślij link znajomym 📨';
  }
  if (PLAY_MUSIC.test(text)) return '`/play` i tytuł puszcza muzykę. Najpierw wejdź na kanał głosowy 🎵';
  if (!asks) return null;
  if (RANKS.test(text)) {
    const config = await getLevelingConfig(client, guild.id).catch(() => null);
    const ranks = Object.entries(config?.roleRewards ?? {})
      .filter(([, roleId]) => guild.roles?.cache?.has?.(roleId))
      .sort(([a], [b]) => Number(a) - Number(b))
      .slice(0, MAX_RANKS);
    if (ranks.length) return `Rangi za poziomy: ${ranks.map(([level, roleId]) => `${level} → <@&${roleId}>`).join(', ')} ⭐ Poziom rośnie za pisanie na czacie.`;
    const [roles] = topicChannels(message, 'Role');
    if (roles) return `Role wybierasz na ${channelLink(roles)} 🎭`;
  }
  if (MC_SERVER.test(text)) {
    const whitelist = await getWhitelistConfig(guild.id).catch(() => null);
    if (whitelist?.enabled && whitelist.channelId) return `Jest! Wpisz swój nick na ${channelLink({ id: whitelist.channelId })} albo użyj \`/minecraft whitelista\`, bot cię dopisze ⛏️`;
    if (!/\bwhitelist\w*\b/.test(text)) return 'Club SMP to prywatny serwer youtuberów, nie da się na niego wejść 🔒 Kto gra: <https://pikczu.pl/smp>';
  }
  if (SMP_WHO.test(text) && SMP_PEOPLE.test(text)) return 'Kto gra na Club SMP: <https://pikczu.pl/smp> 👀';
  if (EARN.test(text)) return 'Kasa: `/work`, `/daily`, `/nagraj`, `/fish`, `/beg` i misje w `/misje` 💰 Z ryzykiem: `/crime`, `/rob` i kasyno. Trzymaj ją w `/bank`.';
  return null;
}

/** The answer to a question about this server, or null. `text` is folded, `raw` is what the member wrote. */
export async function serverAnswer(message, text, raw = message.content) {
  const asks = /\?\s*$/.test(String(raw ?? '')) || ASKS.test(text);
  const channel = /\bkanal\w*\b/.test(text) ? channelAnswer(message, text) : null;
  if (channel) return channel;
  if (BOOST.test(text)) {
    const boost = await boostAnswer(message, text, asks);
    if (boost) return boost;
  }
  if (NEWCOMER.test(text)) return `Witaj! 👋 Zacznij od regulaminu na ${ruleChannel(message)}, potem \`/daily\` i \`/work\`. O serwer pytaj mnie śmiało.`;
  return channelAnswer(message, text) ?? await staffAnswer(message, text, asks) ?? await otherAnswer(message, text, asks)
    ?? (asks ? questionAnswer(message, text) : null);
}

/** Every fixed line here, for the tests (commands named, banned words). */
export const SERVER_LINES = QA.map(([, answer]) => answer).filter((answer) => typeof answer === 'string');

/** A yes/no question about Pikczu that nothing knew: never a guess about a real person. */
export function pikczuLine(text) {
  if (!ABOUT_PIKCZU.test(text)) return null;
  if (/\bjest (fajny|spoko|super|najlepszy|kox\w*|git|dobry|mega|zajebisty|goat)\b/.test(text)) return 'Pewnie! Inaczej by mnie nie zrobił 😎';
  if (PIKCZU_HERE.test(text)) return 'Pikczu tu bywa, ale wiadomości ma mnóstwo i na wszystko nie odpisze 😅 Sprawy do ekipy: ticket, współpraca: kontakt@pikczu.pl 📧';
  return 'Za Pikczu nie zgaduję, to prawdziwy człowiek 😄 Zapytaj go sam albo zajrzyj na <https://pikczu.pl>';
}
