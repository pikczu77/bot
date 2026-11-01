// klubisFacts.js — questions Klubiś can really answer, from the bot's own data (2026-11-01): the member's money, level, warnings, cards,
// the daily, the server, today's date, sums, the running event, other members, what the channel talks about.
// Each answer is built from live values. Returns null when the message asks none of these or the data is not there.

import { STOPWORDS } from '../config/klubisGrammar.js';
import { PRESET_SLURS } from '../config/automodPresets.js';
import { MENTION_RE, cleanText, fold, isVerbWord } from './klubisBrain.js';
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

// ---- What the channel talks about, in memory only.
const channelWords = new Map(); // channel id -> [{ name, words }]

export function noteChannelMessage(message) {
  const words = cleanText(message.content).replace(/[?!.,;:…]+/g, ' ').split(/\s+/).filter((word) => fold(word).length >= 4 && !STOPWORDS.has(fold(word)) && !isVerbWord(fold(word)) && !findSlur(word, PRESET_SLURS));
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

/** The answer to a question about real data, or null. `memoryOf(userId)` reads what Klubiś remembers about a member. */
export async function klubisFact(message, text, { now = Date.now(), memoryOf = async () => null } = {}) {
  const { guild, author, client } = message;
  const sum = sumOf(message.content);
  if (sum) return sum;

  if (/\bktora (jest )?(teraz )?(godzina|godz)\b|\bjaka (jest )?godzina\b/.test(text)) {
    return `Jest ${new Date(now).toLocaleTimeString('pl-PL', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' })} ⏰`;
  }
  if (/\bjaki (dzis|dzisiaj|mamy|jest|dziś) (dzien|dzień)\b|\bktorego (dzis|dzisiaj|mamy)\b|\bjaka (dzis |dzisiaj |jest )?data\b/.test(text)) {
    return `Dzisiaj ${dateOf(now, { weekday: 'long', day: 'numeric', month: 'long' })} 📅`;
  }

  // About another member, by a mention.
  const botId = client?.user?.id;
  const other = [...(message.mentions?.users?.values?.() ?? [])].find((user) => user.id !== botId);
  if (other && /\b(kim|kto|kogo|co)\b.*\b(jest|to|wiesz|znasz|lubi|gra)\b|\bznasz\b/.test(text)) {
    const member = guild.members?.cache?.get(other.id);
    const level = await getUserLevelData(client, guild.id, other.id).catch(() => null);
    const memory = await memoryOf(other.id);
    const parts = [`<@${other.id}>`];
    if (member?.joinedAt) parts.push(`jest tu od ${dateOf(member.joinedAt, { day: 'numeric', month: 'long', year: 'numeric' })}`);
    if (level) parts.push(`poziom ${level.level ?? 0}`);
    const line = `${parts.join(', ')} ⭐`;
    const known = [];
    if (memory?.likes?.length) known.push(`Lubi: ${memory.likes.join(', ')}.`);
    if (memory?.plays?.length) known.push(`Gra ${memory.plays.join(', ')}.`);
    return known.length ? `${line} ${known.join(' ')}` : line;
  }

  if (/\bile mam (kasy|hajsu|pieniedzy|kaski|siana|monet)\b|\bile mam w (banku|portfelu)\b|\bmoj (balans|stan konta)\b|\bjestem bogaty\b|\bjestem bogata\b/.test(text)) {
    const data = await getEconomyData(client, guild.id, author.id);
    return `Masz ${money(guild.id, data.wallet ?? 0)} w portfelu i ${money(guild.id, data.bank ?? 0)} w banku 💰`;
  }
  if (/\bile mam (kart|kard)\b|\bile (kart|ryb) mam\b|\bile mam ryb\b/.test(text)) {
    const data = await getEconomyData(client, guild.id, author.id);
    return `Masz ${count(data.cards)} kart i ${count(data.fishIndex)} złowionych ryb 🃏🎣`;
  }
  if (/\b(jaki|ktory|ile) (mam )?(poziom\w*|lvl|level\w*)\b|\bmoj (poziom|level|lvl)\b|\bile mam (xp|expa|exp|poziomu|poziomow|levela)\b/.test(text)) {
    const level = await getUserLevelData(client, guild.id, author.id);
    return `Masz poziom ${level.level ?? 0} i ${(level.xp ?? 0).toLocaleString('pl-PL')} XP ⭐`;
  }
  if (/\bile mam (warn\w*|ostrzezen\w*)\b|\bmam (jakies )?(warn\w*|ostrzezeni\w*)\b/.test(text)) {
    const settings = await getPunishmentSettings(guild.id);
    const warnings = await activeWarnings(guild.id, author.id, settings, now);
    return warnings.length ? `Masz ostrzeżeń: ${warnings.length} 🚨 Liczą się przez ${settings.expireDays} dni.` : 'Masz czysto, zero ostrzeżeń 😇';
  }
  if (/\bdaily\b|\bdejli\b/.test(text) && /\b(moge|mam|kiedy|odebrac|czy|moje|ile)\b/.test(text)) {
    const settings = await getEconomySettings(guild.id);
    const data = await getEconomyData(client, guild.id, author.id);
    const wait = (data.lastDaily || 0) + cooldownMs(settings.commands.daily.cooldownMinutes) - now;
    return wait > 0 ? `Następne daily za ${waitOf(wait)} ⏰` : 'Daily czeka, odbierz: `/daily` 💰';
  }
  if (/\bile (jest )?(tu )?(nas|osob|ludzi|czlonkow)\b|\bile osob\b/.test(text)) {
    return `Na serwerze jest nas ${(guild.memberCount ?? guild.members?.cache?.size ?? 0).toLocaleString('pl-PL')} 👥`;
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
  return null;
}
