// klubisFacts.js — questions Klubiś can really answer, from the bot's own data (2026-11-01): the member's money, level, warnings, cards,
// the daily, the server, today's date, sums, the running event, other members, what the channel talks about.
// Each answer is built from live values. Returns null when the message asks none of these or the data is not there.

import { STOPWORDS } from '../config/klubisGrammar.js';
import { PRESET_SLURS } from '../config/automodPresets.js';
import { MENTION_RE, cleanText, fold, isVerbWord, parseSentence, plural, safeLike, touchyKind, yearsOld } from './klubisBrain.js';
import { asksLiveQuestion, knowledgeAnswer } from './klubisKnowledge.js';
import { PIKCZU_BORN } from '../config/klubisKnowledge.js';
import { VIDEOS } from '../config/klubisKnowledgeData.js';
import { QUIZ_QUESTIONS } from '../config/quizQuestions.js';
import { runningQuestion } from './quiz.js';
import { openTriviaQuestion } from './chatEngagement.js';
import { COMPANIES, getMarket } from './stockMarket.js';
import { getEconomyPrefix } from '../utils/database.js';
import { getLeaderboard } from './leveling/leveling.js';
import { findSlur } from './automodService.js';
import { getEconomyData } from '../utils/economy.js';
import { getUserLevelData } from './leveling/leveling.js';
import { cooldownMs, getEconomySettings, money } from './economySettings.js';
import { activeWarnings, getPunishmentSettings } from './moderation/warningPunishments.js';
import { nextSeason, openSeason } from './seasonalEvents.js';

const TIME_ZONE = 'Europe/Warsaw';
const CHANNEL_MESSAGES = 40;
const CHANNELS_KEPT = 200;
const MAX_NUMBER = 1e15;
const REMINDERS_PER_MEMBER = 3;
const REMINDER_MAX_MS = 24 * 3_600_000;
const REMINDER_TEXT_MAX = 150;
const TOP_SHOWN = 3;

const cut = (text, max) => (text.length > max ? `${text.slice(0, max).trimEnd()}...` : text);
const dateOf = (at, options) => new Date(at).toLocaleDateString('pl-PL', { timeZone: TIME_ZONE, ...options });
const count = (object) => Object.values(object ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);

function waitOf(ms) {
  const minutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** 2 + 2 * 2 with the right order, from tokens. Null when it cannot be done. */
function calculate(numbers, operators) {
  const values = [numbers[0]];
  const pending = [];
  operators.forEach((operator, i) => {
    const next = numbers[i + 1];
    if (operator === '*') values.push(values.pop() * next);
    else if (operator === '/') values.push(values.pop() / next);
    else {
      pending.push(operator);
      values.push(next);
    }
  });
  const total = pending.reduce((sum, operator, i) => (operator === '+' ? sum + values[i + 1] : sum - values[i + 1]), values[0]);
  return Number.isFinite(total) && Math.abs(total) < MAX_NUMBER ? total : null;
}

const WORD_OPERATORS = { razy: '*', x: '*', '×': '*', plus: '+', dodac: '+', dodać: '+', minus: '-', odjac: '-', odjąć: '-', 'podzielic na': '/', 'podzielić na': '/', przez: '/', ':': '/' };

/** "ile to 2+2*2", "policz 15 razy 3": the answer, or null. Only when asked: a bare "2 3" in a sentence is not a sum. */
export function sumOf(raw) {
  const text = String(raw ?? '').replace(MENTION_RE, ' ').replace(/klubi[sś]\p{L}*/giu, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');
  if (!/\b(ile|policz|oblicz)\b/.test(fold(text)) && !/^[\d\s.,+*/:x×()-]+[=?]*$/.test(text)) return null;
  const match = /-?\d+(?:[.,]\d+)?(?:\s*(?:[-+*/:x×]|razy|plus|dodac|dodać|minus|odjac|odjąć|podzielic na|podzielić na|przez)\s*-?\d+(?:[.,]\d+)?)+/.exec(text);
  if (!match) return null;
  const tokens = match[0].match(/-?\d+(?:[.,]\d+)?|podzieli[cć] na|[a-ząćęłńóśźż]+|[-+*/:×]/g);
  const numbers = [];
  const operators = [];
  for (const token of tokens) {
    const isNumber = /^-?\d/.test(token);
    if (isNumber && numbers.length === operators.length) numbers.push(Number(token.replace(',', '.')));
    else if (isNumber) {
      // "2-2" reads the second number as -2: an operator and a number.
      operators.push('+');
      numbers.push(Number(token.replace(',', '.')));
    } else operators.push(WORD_OPERATORS[token] ?? token);
  }
  if (numbers.length !== operators.length + 1) return null;
  if (operators.some((operator, i) => operator === '/' && numbers[i + 1] === 0)) return 'Przez zero nie dzielę, mam rodzinę 😅';
  const total = calculate(numbers, operators);
  if (total === null) return null;
  return `${match[0].replace(/\s+/g, ' ').replaceAll('*', '×').trim()} = ${total.toLocaleString('pl-PL', { maximumFractionDigits: 4 })} 🧮`;
}

// ---- Days to go.
const easter = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = (a * 19 + b - Math.floor(b / 4) - Math.floor((8 * b + 13) / 25) + 15) % 30;
  const e = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - d - (c % 4)) % 7;
  const m = Math.floor((a + 11 * d + 22 * e) / 451);
  const month = Math.floor((d + e - 7 * m + 114) / 31);
  return [month - 1, ((d + e - 7 * m + 114) % 31) + 1];
};
const DATES = [
  [/\b(swiat|swieta|swieto|wigili\w*|bozego narodzenia|gwiazdk\w*)\b/, 'Wigilii', () => [11, 24]],
  [/\b(sylwester\w*)\b/, 'Sylwestra', () => [11, 31]],
  [/\b(nowego roku|nowy rok)\b/, 'Nowego Roku', () => [0, 1]],
  [/\b(walentyn\w*)\b/, 'Walentynek', () => [1, 14]],
  [/\b(wielkanoc\w*)\b/, 'Wielkanocy', easter],
  [/\b(dnia dziecka|dzien dziecka)\b/, 'Dnia Dziecka', () => [5, 1]],
  [/\b(halloween\w*)\b/, 'Halloween', () => [9, 31]],
  [/\b(niepodleglosci)\b/, 'Święta Niepodległości', () => [10, 11]],
  [/\burodzin\w* pikcz\w*|\bpikcz\w* urodzin\w*/, 'urodzin Pikczu', () => [11, 11]],
];

/** "Ile dni do świąt?": counted in Polish time. */
function daysTo(text, now) {
  if (!/\b(ile|kiedy|za ile)\b/.test(text)) return null;
  const found = DATES.find(([match]) => match.test(text));
  if (!found) return null;
  const warsaw = new Date(new Date(now).toLocaleString('en-US', { timeZone: TIME_ZONE }));
  const today = Date.UTC(warsaw.getFullYear(), warsaw.getMonth(), warsaw.getDate());
  let [month, day] = found[2](warsaw.getFullYear());
  let target = Date.UTC(warsaw.getFullYear(), month, day);
  if (target < today) {
    [month, day] = found[2](warsaw.getFullYear() + 1);
    target = Date.UTC(warsaw.getFullYear() + 1, month, day);
  }
  const days = Math.round((target - today) / 86_400_000);
  const date = new Date(target).toLocaleDateString('pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'long' });
  return days === 0 ? `Do ${found[1]} zero dni, to dzisiaj! 🎉` : `Do ${found[1]} ${plural(days, 'został', 'zostały', 'zostało')} ${days} ${plural(days, 'dzień', 'dni', 'dni')} (${date}) 📅`;
}

// ---- Reminders, in memory only: a restart forgets them.
const reminders = new Map(); // `${guildId}:${userId}` -> how many are waiting

/** "Za 10 minut", "za godzinę", "za 2 godziny", "za pół godziny" in folded text: milliseconds, or null. */
export function delayOf(text) {
  if (/\bza pol godziny\b/.test(text)) return 1_800_000;
  if (/\bza godzine\b/.test(text)) return 3_600_000;
  if (/\bza minute\b/.test(text)) return 60_000;
  const match = /\bza (\d{1,4}) ?(min|minut|minuty|minute|m|h|godz|godzin|godziny|godzine|sek|sekund|sekundy|s)\b/.exec(text);
  if (!match) return null;
  const count = Number(match[1]);
  return count * (/^(h|godz)/.test(match[2]) ? 3_600_000 : /^s/.test(match[2]) ? 1000 : 60_000);
}

function setReminder(message, text) {
  const delay = delayOf(text);
  if (!delay) return 'Kiedy? Napisz: „Klubiś, przypomnij mi za 10 minut o obiedzie” ⏰';
  if (delay > REMINDER_MAX_MS) return 'Najwyżej 24 godziny naprzód. Dłużej bym nie zapamiętał ⏰';
  const key = `${message.guild.id}:${message.author.id}`;
  if ((reminders.get(key) ?? 0) >= REMINDERS_PER_MEMBER) return `Masz już ${REMINDERS_PER_MEMBER} przypomnienia. Poczekaj, aż któreś zadzwoni ⏰`;
  const what = cut(cleanText(message.content).replace(/^(a |no )?(czy )?(mozesz |możesz )?przypomnij( mi)?|^(a |no )?(czy )?(mozesz |możesz )?(mi )?przypomniec/iu, '')
    .replace(/\bza\s+(\d{1,4}\s*\p{L}+|pół godziny|pol godziny|godzinę|godzine|minutę|minute)/iu, '').replace(/^\s*(o|że|ze|żeby|zeby)\s+/iu, '').replace(/[?!.,\s]+$/, '').trim(), REMINDER_TEXT_MAX);
  reminders.set(key, (reminders.get(key) ?? 0) + 1);
  const timer = setTimeout(() => {
    reminders.set(key, Math.max(0, (reminders.get(key) ?? 1) - 1));
    message.channel?.send?.({ content: `⏰ <@${message.author.id}>, przypominam${what ? `: ${what}` : '!'}`, allowedMentions: { parse: [], users: [message.author.id] } }).catch(() => {});
  }, delay);
  timer.unref?.();
  return `Dobra, przypomnę ${delay < 3_600_000 ? `za ${Math.round(delay / 60_000) || 1} min` : `za ${Math.round(delay / 360_000) / 10} h`}${what ? `: ${what}` : ''} ⏰ Tylko nie restartujcie mnie w tym czasie 😅`;
}

// ---- What the channel talks about, in memory only.
const channelWords = new Map(); // channel id -> [{ name, words }]

export function noteChannelMessage(message) {
  const words = cleanText(message.content).replace(/[?!.,;:…]+/g, ' ').split(/\s+/).filter((word) => fold(word).length >= 4 && !STOPWORDS.has(fold(word)) && !isVerbWord(fold(word)) && !findSlur(word, PRESET_SLURS) && !touchyKind(word));
  const list = channelWords.get(message.channelId) ?? [];
  list.push({ name: message.member?.displayName ?? message.author?.username ?? '', words });
  while (list.length > CHANNEL_MESSAGES) list.shift();
  channelWords.delete(message.channelId);
  channelWords.set(message.channelId, list);
  if (channelWords.size > CHANNELS_KEPT) channelWords.delete(channelWords.keys().next().value);
}

const topOf = (values, limit) => {
  const counts = new Map();
  for (const value of values) {
    const key = fold(value);
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map((entry) => entry.value);
};

function channelSummary(message) {
  // The last message is the question itself.
  const list = (channelWords.get(message.channelId) ?? []).slice(0, -1);
  if (list.length < 2) return 'Cicho tu było. Nic cię nie ominęło 🤫';
  const topics = topOf(list.flatMap((item) => item.words), 5);
  const people = topOf(list.map((item) => item.name).filter(Boolean), 3);
  return `Ostatnio tutaj: ${topics.join(', ') || 'głównie emotki'} 🗨️ Najwięcej piszą: ${people.join(', ')}.`;
}

const hashPercent = (text) => [...text].reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261) % 101;

/** The answer to a question about real data, or null. `memoryOf(userId)` reads what Klubiś remembers about a member. */
export async function klubisFact(message, text, { now = Date.now(), random = Math.random, memoryOf = async () => null } = {}) {
  const { guild, author, client } = message;
  // The question a quiz or the question of the day pays for: no help with that one.
  const running = runningQuestion(guild.id);
  const live = [running && QUIZ_QUESTIONS[running.index]?.q, await openTriviaQuestion(guild.id, now)].filter(Boolean);
  if (live.some((question) => asksLiveQuestion(text, question))) return 'Teraz trwa to pytanie, nie podpowiadam 🤐';

  const sum = sumOf(message.content);
  if (sum) return sum;

  // Things it can really do.
  if (/^(a |no )?(czy )?(mozesz )?(przypomnij|mi przypomniec|przypomniec)\b/.test(text)) return setReminder(message, text);
  if (/\b(rzuc|rzut|rzucisz|rzucaj)\b.*\b(kostk\w*|kosc\w*)\b|^kostka$/.test(text)) return `🎲 Wypadło ${Math.floor(random() * 6) + 1}`;
  if (/\b(rzuc|rzut|rzucisz|rzucaj)\b.*\bmonet\w*\b|\borzel czy reszka\b|^moneta$/.test(text)) return `🪙 ${random() < 0.5 ? 'Orzeł' : 'Reszka'}`;
  if (/\b(wylosuj|losuj|podaj|daj)\b.*\b(liczb\w*|numer\w*)\b/.test(text)) {
    const range = /\bod (\d{1,9}) do (\d{1,9})\b/.exec(text);
    const [low, high] = range ? [Number(range[1]), Number(range[2])] : [1, 100];
    if (high <= low) return 'Od większej do mniejszej? Tak się nie da 😅';
    return `🎲 ${low + Math.floor(random() * (high - low + 1))}`;
  }
  if (/\b(ile|na ile) procent\b/.test(text)) return `Na ${hashPercent(text)}%. Moje bity tak mówią 📊`;
  const days = daysTo(text, now);
  if (days) return days;
  if (/\bkiedy (tu )?(dolaczyl\w*|przyszedl\w*|przyszla\w*|wszedl\w*|weszla\w*)\b|\bod kiedy (tu )?jestem\b/.test(text) && message.member?.joinedAt) {
    return `Jesteś tu od ${dateOf(message.member.joinedAt, { day: 'numeric', month: 'long', year: 'numeric' })} 📅`;
  }
  if (/\bjakie mam role\b|\bjaka mam (role|range)\b|\bjakie mam rangi\b/.test(text) && message.member?.roles?.cache) {
    const names = [...message.member.roles.cache.values()].filter((role) => role.id !== guild.id).map((role) => role.name).slice(0, 15);
    return names.length ? `Twoje role: ${names.join(', ')} 🎭` : 'Nie masz jeszcze żadnej roli 🎭';
  }

  if (/\bktora (jest )?(teraz )?(godzina|godz)\b|\bjaka (jest )?godzina\b/.test(text)) {
    return `Jest ${new Date(now).toLocaleTimeString('pl-PL', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' })} ⏰`;
  }
  if (/\bjaki (dzis|dzisiaj|mamy|jest|dziś) (dzien|dzień)\b|\bktorego (dzis|dzisiaj|mamy)\b|\bjaka (dzis |dzisiaj |jest )?data\b/.test(text)) {
    return `Dzisiaj ${dateOf(now, { weekday: 'long', day: 'numeric', month: 'long' })} 📅`;
  }

  // About another member, by a mention.
  const botId = client?.user?.id;
  const other = [...(message.mentions?.users?.values?.() ?? [])].find((user) => user.id !== botId);
  // The mention is gone from `text`, so "co myslisz o @Kuba" reads "co myslisz o". Only what is safe to tell about someone else.
  if (other && /\b(kim|kto|kogo|co|z kim)\b.*\b(jest|to|wiesz|znasz|lubi|gra|kocha|myslisz|sadzisz|powiesz)\b|\bznasz\b/.test(text)) {
    const member = guild.members?.cache?.get(other.id);
    const level = await getUserLevelData(client, guild.id, other.id).catch(() => null);
    const memory = await memoryOf(other.id);
    const parts = [`<@${other.id}>`];
    if (member?.joinedAt) parts.push(`jest tu od ${dateOf(member.joinedAt, { day: 'numeric', month: 'long', year: 'numeric' })}`);
    if (level) parts.push(`poziom ${level.level ?? 0}`);
    const opinion = /\b(myslisz|sadzisz|powiesz)\b/.test(text) ? 'Mam dobre zdanie, ale to bot tak mówi 😄 ' : '';
    const line = `${opinion}${parts.join(', ')} ⭐`;
    const known = [];
    const likes = (memory?.likes ?? []).filter(safeLike);
    if (likes.length) known.push(`Lubi: ${likes.join(', ')}.`);
    if (memory?.plays?.length) known.push(`Gra ${memory.plays.join(', ')}.`);
    if (memory?.loves?.length) known.push(`Kocha: ${memory.loves.join(', ')}.`);
    if (/\b(z kim|kogo|kocha|zwiazk\w*|chlopak\w*|dziewczyn\w*)\b/.test(text) && !known.length) known.push('Nic o tym nie wiem 🤷');
    return known.length ? `${line} ${known.join(' ')}` : line;
  }

  if (/\bile mam (kasy|hajsu|pieniedzy|kaski|siana|monet)\b|\bile mam w (banku|portfelu)\b|\bmoj (balans|stan konta)\b|\bjestem bogaty\b|\bjestem bogata\b/.test(text)) {
    const data = await getEconomyData(client, guild.id, author.id);
    return `Masz ${money(guild.id, data.wallet ?? 0)} w portfelu i ${money(guild.id, data.bank ?? 0)} w banku 💰`;
  }
  if (/\bile mam (kart|kard)\b|\bile (kart|ryb) mam\b|\bile mam ryb\b/.test(text)) {
    const data = await getEconomyData(client, guild.id, author.id);
    const cards = count(data.cards);
    const fish = count(data.fishIndex);
    return `Masz ${cards} ${plural(cards, 'kartę', 'karty', 'kart')} i ${fish} ${plural(fish, 'złowioną rybę', 'złowione ryby', 'złowionych ryb')} 🃏🎣`;
  }
  if (/\b(jaki|ktory|ile) (mam )?(poziom\w*|lvl|level\w*)\b|\bmoj (poziom|level|lvl)\b|\bile mam (xp|expa|exp|poziomu|poziomow|levela)\b/.test(text)) {
    const level = await getUserLevelData(client, guild.id, author.id);
    return `Masz poziom ${level.level ?? 0} i ${(level.xp ?? 0).toLocaleString('pl-PL')} XP ⭐`;
  }
  if (/\bile mam (warn\w*|ostrzezen\w*)\b|\bmam (jakies )?(warn\w*|ostrzezeni\w*)\b/.test(text)) {
    const settings = await getPunishmentSettings(guild.id);
    const warnings = await activeWarnings(guild.id, author.id, settings, now);
    return warnings.length ? `Masz ${warnings.length} ${plural(warnings.length, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń')} 🚨 Liczą się przez ${settings.expireDays} ${plural(settings.expireDays, 'dzień', 'dni', 'dni')}.` : 'Masz czysto, zero ostrzeżeń 😇';
  }
  if (/\bdaily\b|\bdejli\b/.test(text) && /\b(moge|mam|kiedy|odebrac|czy|moje|ile)\b/.test(text)) {
    const settings = await getEconomySettings(guild.id);
    const data = await getEconomyData(client, guild.id, author.id);
    const wait = (data.lastDaily || 0) + cooldownMs(settings.commands.daily.cooldownMinutes) - now;
    return wait > 0 ? `Następne daily za ${waitOf(wait)} ⏰` : 'Daily czeka, odbierz: `/daily` 💰';
  }
  if (/\bile (jest )?(tu )?(nas|osob|ludzi|czlonkow)\b|\bile osob\b/.test(text)) {
    const people = guild.memberCount ?? guild.members?.cache?.size ?? 0;
    return `Na serwerze ${plural(people, 'jest', 'są', 'jest')} ${people.toLocaleString('pl-PL')} ${plural(people, 'osoba', 'osoby', 'osób')} 👥`;
  }
  if (/\bkto (jest )?(tu )?(wlascicielem|wlasciciel|zalozycielem|zalozyl)\b/.test(text)) {
    return guild.ownerId ? `Właściciel serwera to <@${guild.ownerId}> 👑` : null;
  }
  if (/\bkiedy (powstal|zalozono|stworzono|zrobiono)\b.*\bserwer\b|\bile lat ma serwer\b/.test(text) && guild.createdAt) {
    return `Serwer powstał ${dateOf(guild.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })} 🎂`;
  }
  if (/\bevent\w*\b/.test(text) && /\b(jaki|jest|teraz|trwa|kiedy|co|nastepny)\b/.test(text)) {
    const open = await openSeason(guild.id, now);
    if (open) return `Trwa ${open.event.emoji} ${open.event.roleBase} ${open.event.year}, do ${dateOf(open.settings.endsAt - 1, { day: 'numeric', month: 'long' })}. Sklep: \`/event sklep\``;
    const next = await nextSeason(guild.id, now);
    return next ? `Teraz nic. Następny: ${next.event.emoji} ${next.event.roleBase} ${next.event.year}, od ${dateOf(next.settings.startsAt, { day: 'numeric', month: 'long' })} 🎉` : null;
  }
  if (/\bo czym (tu |wy )?(gadacie|rozmawiacie|piszecie)\b|\bco (mnie )?(ominelo|przegapilem|przegapilam)\b|\bco tu sie dzieje\b/.test(text)) {
    return channelSummary(message);
  }

  // Rankings and the market.
  if (/\bkto (ma|jest) (tu |na serwerze )?(najwiecej (kasy|hajsu|pieniedzy|kaski)|najbogatsz\w*)\b/.test(text)) {
    const prefix = getEconomyPrefix(guild.id);
    const keys = await client.db.list(prefix);
    const rows = [];
    for (const key of Array.isArray(keys) ? keys : []) {
      const data = await client.db.get(key);
      if (data) rows.push({ id: key.replace(prefix, ''), total: (data.wallet || 0) + (data.bank || 0) });
    }
    const top = rows.sort((a, b) => b.total - a.total).slice(0, TOP_SHOWN);
    return top.length ? `Najwięcej kasy: ${top.map((row) => `<@${row.id}> (${money(guild.id, row.total)})`).join(', ')} 💰` : 'Cały ranking pokaże `/topkasa` 💰';
  }
  if (/\bkto ma (najwyzszy|najwiekszy) (poziom|level|lvl)\b|\bkto ma najwiecej (xp|expa)\b/.test(text)) {
    const top = await getLeaderboard(client, guild.id, TOP_SHOWN);
    return top?.length ? `Najwyższe poziomy: ${top.map((row) => `<@${row.userId}> (${row.level})`).join(', ')} ⭐` : 'Cały ranking pokaże `/top` ⭐';
  }
  if (/\bloteri\w*\b/.test(text)) return 'Loterii już nie ma, Pikczu ją wyłączył 🎟️';
  if (/\b(gield\w*|akcj\w*)\b/.test(text) && /\b(ile|jak|jakie|ceny|cena|stoi|stoja|co)\b/.test(text)) {
    const market = await getMarket(guild.id, now);
    return `Ceny na \`/gielda\`: ${COMPANIES.map((company) => `${company.emoji} ${company.name} ${money(guild.id, market.prices[company.id] ?? company.base)}`).join(', ')} 📈`;
  }
  if (/\bz kim (jestem|mam slub|mam wspolny bank)\b|\bkto jest moim? (zona|mezem|partnerem)\b|\bkto jest moja (zona|partnerka)\b/.test(text)) {
    const data = await getEconomyData(client, guild.id, author.id);
    if (data._joint?.partnerId) return `Twój ślub: <@${data._joint.partnerId}> 💍`;
    const own = await memoryOf(author.id);
    return own?.partner ? null : 'Nikogo tu jeszcze nie ma. Napisz: „Klubiś, jestem w związku z ...”, to zapamiętam. Albo spróbuj `/randka` 🌹';
  }
  if (/\bile (jest )?kanalow\b/.test(text)) {
    const channels = guild.channels?.cache?.size ?? 0;
    return `Na serwerze ${plural(channels, 'jest', 'są', 'jest')} ${channels} ${plural(channels, 'kanał', 'kanały', 'kanałów')} 📋`;
  }
  if (/\bile (jest )?rol\b/.test(text)) {
    const roles = guild.roles?.cache?.size ?? 0;
    return `Na serwerze ${plural(roles, 'jest', 'są', 'jest')} ${roles} ${plural(roles, 'rola', 'role', 'ról')} 🎭`;
  }

  // Pikczu, counted today.
  if (/\bpikcz\w*\b/.test(text) && /\b(ile|wiek|stary|urodzin\w*|urodzil\w*|kiedy)\b/.test(text) && /\b(lat|wiek|stary|urodzin\w*|urodzil\w*)\b/.test(text)) {
    const born = new Date(PIKCZU_BORN);
    const today = new Date(now);
    const hadBirthday = today.getMonth() > born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
    return `Pikczu urodził się 11 grudnia 2009 roku, ma ${yearsOld(today.getFullYear() - born.getFullYear() - (hadBirthday ? 0 : 1))} 🎂`;
  }
  if (/\b(suby?|subow|subskrybent\w*|subskrypcj\w*)\b/.test(text) && /\b(ile|pikcz\w*|kanal\w*)\b/.test(text)) {
    return `Główny kanał Pikczu ma ponad ${Math.floor(VIDEOS.subscribers / 10_000) * 10} tys. subskrybentów, stan z ${dateOf(VIDEOS.videosAt, { day: 'numeric', month: 'long' })} 🔔`;
  }
  if (/\b(ostatni|najnowszy|nowy) (film|filmik|odcinek)\b|\bjaki (byl )?ostatni film\b/.test(text) && VIDEOS.latest[0]) {
    return `Ostatni film, jaki znam: „${VIDEOS.latest[0].title}” <https://youtu.be/${VIDEOS.latest[0].id}> 🎬`;
  }
  if (/\b(najpopularniejszy|najlepszy|najbardziej znany|najwiecej wyswietlen)\b.*\b(film|filmik)?\b/.test(text) && /\b(film|filmik|odcinek|wyswietlen)\b/.test(text) && VIDEOS.mostViewed[0]) {
    const video = VIDEOS.mostViewed[0];
    return `Z filmów, które znam, najwięcej wyświetleń ma „${video.title}”: ${video.views.toLocaleString('pl-PL')} <https://youtu.be/${video.id}> 🎬`;
  }

  return knowledgeAnswer(text, parseSentence(message.content));
}
