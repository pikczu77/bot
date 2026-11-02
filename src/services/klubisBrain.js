// klubisBrain.js — how Klubiś reads a sentence (2026-11-01). No AI and nothing on the network: it finds who the sentence is about (the
// member, Klubiś or someone else), its verb and whether it asks something, turns it around like a person would ("lubię pizzę" -> "lubisz
// pizzę") and picks lines for that kind of sentence. Words and lines: config/klubisGrammar.js.
//
// It understands the shape of a sentence, not its meaning, so what it says back is built from the member's own words. It cannot answer a
// fact it does not have; real facts come from services/klubisFacts.js.

import {
  ANSWER_MAYBE, ANSWER_NO, ANSWER_YES, ASKED_NO, ASKED_TO_DO, ASKED_TO_SAY, ASKED_UNKNOWN, SAY_COMMANDS, ASKED_YES, BAD_WORDS, BEING_HIT, GAME_WORDS, HITTING_OTHERS, HIT_WORDS, QUESTION_PREPOSITIONS, KILL_WORDS, LIKE_TOUCHY, SAFE_LIKES, TOUCHY_WORDS, WONT_TOUCH, COMMANDS, FEELINGS, FILLERS, GOOD_WORDS, GREETINGS, HAVE_PERSON, INSULT_WORDS, JUST_CALLING, LEARNED,
  LONG_TEXT, NOT_PAST, ONE_WORD, PERSON_WORDS, SAID_INSULT,
  PAST_STEMS, PREPOSITIONS, PRONOUN_PAIRS, PRONOUNS, QUESTION_WORDS, RECALLED, SAID_ABOUT_ME, SAID_ABOUT_ME_BAD, SAID_ABOUT_ME_GOOD, SAID_ABOUT_SELF, SAID_OTHER,
  SAID_OTHER_BAD, SAID_OTHER_GOOD, STOPWORDS, VERB_GROUPS, WILL_NOT_REPEAT, ME_TO_YOU, NOT_VERB_AM, NOT_VERB_ASZ, WITH_ACCENTS, YOU_TO_ME,
} from '../config/klubisGrammar.js';
import { KLUBIS_SKILLS } from '../config/klubisReplies.js';
import { PRESET_SLURS } from '../config/automodPresets.js';
import { findSlur } from './automodService.js';

/** Lower case, no Polish letters, punctuation as spaces, stretched letters cut ("seriooo" = "serio"): what the skills match. */
export const fold = (text) => String(text ?? '').toLocaleLowerCase('pl').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').replace(/([a-z])\1{2,}/g, '$1').trim();

export const MENTION_RE = /<@[!&]?\d{15,22}>/g;
// Past the end of this a sentence is not said back as a whole.
const ECHO_MAX = 70;
const LONG_WORDS = 14;
// "Czy wygram?" asked twice gets the same side.
const YES_PERCENT = 45;
const NO_PERCENT = 40;
const LIKE_MAX = 40;
const NOTE_MAX = 120;
const NOTEBOOK_WORDS = 14;
const PARTNER_WORDS_MAX = 10;
const FACT_WORDS_MAX = 5;

const VERBS_ME = new Map();
const VERBS_YOU = new Map();
for (const [group, pairs] of Object.entries(VERB_GROUPS)) {
  for (const [me, you] of pairs) {
    VERBS_ME.set(fold(me), { group, me, you });
    VERBS_YOU.set(fold(you), { group, me, you });
  }
}

/** "1 rok", "22 lata", "25 lat": the Polish rule for a noun after a number. */
export function plural(count, one, few, many) {
  const n = Math.abs(Number(count));
  if (n === 1) return one;
  const tens = n % 100;
  const ones = n % 10;
  return ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? few : many;
}
export const yearsOld = (age) => `${age} ${plural(age, 'rok', 'lata', 'lat')}`;

const ENDINGS = ['ami', 'ach', 'owi', 'emu', 'ego', 'iem', 'ich', 'ych', 'imi', 'ymi', 'owie', 'ow', 'om', 'em', 'ie', 'ej', 'ym', 'im', 'a', 'e', 'i', 'o', 'u', 'y'];
// k becomes c ("karta", "karcie"), g becomes dz, r becomes rz.
const SOFTENED = { t: 'c', k: 'c', g: 'dz', d: 'dz', r: 'rz' };
/** The part of a folded word that stays in every case: "bogów", "bogu", "boga" -> "bog". With `also` when the last letter softens. */
export function wordStem(word) {
  let stem = word;
  const ending = ENDINGS.find((item) => word.endsWith(item) && word.length - item.length >= 3);
  if (ending) stem = word.slice(0, -ending.length);
  const last = stem.at(-1);
  return SOFTENED[last] ? { prefix: stem, also: stem.slice(0, -1) + SOFTENED[last] } : { prefix: stem };
}

/** Does a folded word have this stem? The softened form only before e or i ("karcie", "rzadce"), or "kota" would take "kochasz". */
export const stemFits = (stem, token) => token.startsWith(stem.prefix) || Boolean(stem.also && token.startsWith(stem.also) && /^[ei]/.test(token.slice(stem.also.length)));

const pastEnding = (word, endings) => endings.some((ending) => word.endsWith(ending));
const isPast = (word, previous, endings) => {
  if (word.length < 5 || NOT_PAST.has(word) || PREPOSITIONS.has(previous) || !pastEnding(word, endings)) return false;
  const stem = word.slice(0, -2);
  return /[aeiouy]l$/.test(stem) || PAST_STEMS.test(stem);
};
const isPastMe = (word, previous = '') => isPast(word, previous, ['em', 'am']);
const isPastYou = (word, previous = '') => isPast(word, previous, ['es', 'as']);

const ending = (word, table) => table.find(([from]) => word.endsWith(from));

/**
 * A word as a verb in the verb's place in a sentence: { person, me, you, group } or null. First the verbs in the table, then the past, the conditional
 * ("zrobiłbym"), "we" ("gramy"), then any other verb by its ending. `subject`: the sentence has "ja" or "ty" in front of it.
 */
function verbFrom(raw, word, previous = '', subject = '', next = '') {
  if (COMMANDS[word] || SAY_COMMANDS.has(word)) return null;
  const known = VERBS_ME.get(word) ?? VERBS_YOU.get(word);
  if (known) return { person: VERBS_ME.has(word) ? 'me' : 'you', me: known.me, you: known.you, group: known.group };
  const lower = raw.toLocaleLowerCase('pl');
  if (isPastMe(word, previous) || isPastYou(word, previous)) return { person: isPastMe(word, previous) ? 'me' : 'you', group: 'past', past: true };
  if (/l(a)?bym$/.test(word)) return { person: 'me', me: lower, you: `${lower.slice(0, -1)}ś`, group: /^chcial/.test(word) ? 'want' : 'do' };
  if (/l(a)?bys$/.test(word)) return { person: 'you', me: `${lower.replace(/[łl]a?by[sś]$/, 'ł')}bym`, you: lower, group: /^chcial/.test(word) ? 'want' : 'do' };
  if (/(li|ly)smy$/.test(word)) return { person: 'me', me: lower, you: `${lower.slice(0, -3)}ście`, group: 'past', past: true };
  if (/(li|ly)scie$/.test(word)) return { person: 'you', me: `${lower.slice(0, -4)}śmy`, you: lower, group: 'past', past: true };
  if (word.length >= 5 && /[aie]my$/.test(word) && !/mamy$/.test(word)) return { person: 'me', me: lower, you: `${lower.slice(0, -2)}cie`, group: 'do' };

  // "You" has a clear ending.
  const toMe = word.length >= 4 && !NOT_VERB_ASZ.has(word) ? ending(word, YOU_TO_ME) : null;
  if (toMe) return { person: 'you', me: `${word.slice(0, -toMe[0].length)}${toMe[1]}`, you: lower, group: 'do' };

  // "I" does not: "szkołę" also ends in ę. Only for a clear ending, and never when the next word is the verb ("wodę piję").
  if (VERBS_ME.has(next) || VERBS_YOU.has(next)) return null;
  if (word.length >= 4 && word.endsWith('am') && !NOT_VERB_AM.has(word)) return { person: 'me', me: lower, you: `${lower.slice(0, -2)}asz`, group: 'do' };
  if (word.length >= 5 && /[ui]je$/.test(word)) return { person: 'me', me: `${lower.slice(0, -1)}ę`, you: `${lower.replace(/[eę]$/, '')}esz`, group: 'do' };
  const spelled = lower.endsWith('ę') ? lower : subject === 'ja' && lower.endsWith('e') ? `${lower.slice(0, -1)}ę` : null;
  const toYou = spelled ? ending(spelled, ME_TO_YOU) : null;
  if (toYou) return { person: 'me', me: spelled, you: `${spelled.slice(0, -toYou[0].length)}${toYou[1]}`, group: 'do' };
  return null;
}

/** Where the verb is: after words that change nothing, as in "no ja dzisiaj nie gram". { index, verb, negated }. */
function findVerb(words, from = 0) {
  const folded = words.map((word) => fold(word));
  let negated = false;
  let subject = '';
  for (let i = from; i < Math.min(folded.length, 7); i += 1) {
    const word = folded[i];
    if (word === 'nie') negated = true;
    else if (word === 'ja' || word === 'ty') subject = word;
    else if (!FILLERS.has(word) && !PRONOUNS[word] && word !== 'sie') {
      const verb = verbFrom(words[i], word, i ? folded[i - 1] : '', subject, folded[i + 1] ?? '');
      return verb ? { index: i, verb, negated } : { index: -1, verb: null, negated };
    }
  }
  return { index: -1, verb: null, negated };
}

/**
 * A message Klubiś must not say back or agree with: 'touchy', 'hit' (someone hitting it or someone else), or null. Klubiś repeats words, so anybody
 * could make it say anything otherwise. It only reads folded words, so it also misses things: the answers that agree are limited too (`SAFE_LIKES`).
 */
export function touchyKind(text) {
  const tokens = fold(text).split(' ').filter(Boolean);
  if (tokens.some((word) => TOUCHY_WORDS.test(word))) return /\bdzien dziecka\b/.test(tokens.join(' ')) ? null : 'touchy';
  if (/\bma (malego|duzego|malutkiego|wielkiego|krotkiego|dlugiego)\b|\b(rozmiar|dlugosc) (jego|jej)\b/.test(tokens.join(' '))) return 'touchy';
  if (tokens.some((word) => KILL_WORDS.test(word)) && !tokens.some((word) => GAME_WORDS.test(word))) return 'touchy';
  return tokens.some((word) => HIT_WORDS.test(word)) ? 'hit' : null;
}

/** The answer to such a message. Hitting is about Klubiś when it says "cię" or the message replies to Klubiś without naming anyone else. */
export function touchyLine(kind, pick, text = '') {
  if (kind !== 'hit') return pick(WONT_TOUCH, 'wontTouch');
  return /\b(cie|ciebie|bota|bot)\b/.test(fold(text)) ? pick(BEING_HIT, 'beingHit') : pick(HITTING_OTHERS, 'hittingOthers');
}

/** "Lubię 12 latki", "chcę młode": no echo and no record, it is the same bait with other words. */
export const likesTouchy = (parsed) => (parsed.group === 'like' || parsed.group === 'want') && parsed.words.slice(parsed.index + 1).some((word) => LIKE_TOUCHY.test(fold(word)));

/** Fit to say out loud: "Zapamiętam, że lubisz pizzę", or a like told to someone else. */
export const safeLike = (like) => fold(like).split(' ').some((word) => SAFE_LIKES.test(word));

/** A verb or a past form: not a topic of a talk. */
export const isVerbWord = (word) => Boolean(verbFrom(word, word));

/** The message only calls Klubiś: "ej", "halo", nothing else that means anything. */
export const onlyCalls = (parsed) => parsed.words.every((word) => FILLERS.has(fold(word)) || JUST_CALLING.has(fold(word)) || GREETINGS.has(fold(word)));

const capital = (text) => (text ? text[0].toLocaleUpperCase('pl') + text.slice(1) : text);

/** The member's words without mentions, links, Klubiś's name or Discord formatting. */
export const cleanText = (raw) => String(raw ?? '').replace(MENTION_RE, ' ').replace(/https?:\S+/gi, ' ').replace(/klubi[sś]\p{L}*/giu, ' ')
  .replace(/[`*_~|>#@<{}\\"„”“«»]/g, '').replace(/\s+/g, ' ').replace(/^[\s,.:;!?-]+/, '').trim();

/** The words said from the other side: I becomes you and you becomes I, verbs and pronouns too, in Polish letters. Klubiś's own past forms are masculine. */
export function reflect(words) {
  const start = words.findIndex((word) => fold(word) === 'czy') + 1;
  const place = findVerb(words, start);
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i];
    const word = fold(raw);
    const previous = i ? fold(words[i - 1]) : '';
    const pair = i + 1 < words.length ? PRONOUN_PAIRS[`${word} ${fold(words[i + 1])}`] : null;
    if (pair) {
      out.push(pair);
      i += 1;
    } else if (i === place.index && !place.verb.past) out.push(place.verb.person === 'me' ? place.verb.you : place.verb.me);
    else if (i === place.index && (/smy$/.test(word) || /scie$/.test(word))) out.push(place.verb.person === 'me' ? place.verb.you : place.verb.me);
    else if (VERBS_ME.has(word) && (raw.toLocaleLowerCase('pl') === VERBS_ME.get(word).me || !VERBS_ME.get(word).me.endsWith('ę') || ['ze', 'bo', 'gdy', 'jak', 'kiedy'].includes(previous))) out.push(VERBS_ME.get(word).you);
    else if (VERBS_YOU.has(word)) out.push(VERBS_YOU.get(word).me);
    else if (isPastMe(word, previous)) out.push(`${raw.slice(0, -3)}ł${word.endsWith('em') ? 'eś' : 'aś'}`);
    else if (isPastYou(word, previous)) out.push(`${raw.slice(0, -3)}łem`);
    else if (PRONOUNS[word]) out.push(raw.endsWith('ą') ? PRONOUNS[word].replace(/a$/, 'ą') : PRONOUNS[word]);
    else out.push(raw === raw.toLocaleLowerCase('pl') ? WITH_ACCENTS[word] ?? raw : raw);
  }
  return out;
}

/** What a sentence is: { words, person (me, you, other), group, verb, index, negated, past, question, asks, qSkill, greeted, asksBack }. */
export function parseSentence(raw) {
  const clean = cleanText(raw);
  const question = /\?\s*$/.test(clean);
  let words = clean.replace(/[?!.…;:,]+/g, ' ').split(/\s+/).filter(Boolean);
  const greeted = words.length > 1 && GREETINGS.has(fold(words[0]));
  if (greeted) words = words.slice(1);
  const asksBack = words.length > 2 && fold(words.at(-2)) === 'a' && fold(words.at(-1)) === 'ty';
  if (asksBack) words = words.slice(0, -2);

  const parsed = { words, person: 'other', group: null, verb: null, index: -1, negated: false, past: false, question: question && !asksBack, asks: false, qSkill: null, greeted, asksBack };
  const folded = words.map((word) => fold(word));
  const start = folded.findIndex((word) => word !== 'a' && word !== 'no' && word !== 'ale');
  const first = folded[start];
  if (first === 'czy') parsed.asks = true;
  else if (first && QUESTION_WORDS[first]) parsed.qSkill = QUESTION_WORDS[first];
  else if (QUESTION_PREPOSITIONS.has(first) && QUESTION_WORDS[folded[start + 1]]) parsed.qSkill = QUESTION_WORDS[folded[start + 1]];

  const place = findVerb(words, parsed.asks ? folded.indexOf('czy') + 1 : 0);
  parsed.negated = place.negated;
  if (place.verb) {
    parsed.verb = place.verb.past ? null : { me: place.verb.me, you: place.verb.you, group: place.verb.group };
    parsed.group = place.verb.group;
    parsed.person = place.verb.person;
    parsed.past = Boolean(place.verb.past);
    parsed.index = place.index;
  }
  return parsed;
}

const hash = (text) => [...text].reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
/** The same question gets the same side: 'yes', 'no' or 'maybe'. */
function sideOf(text) {
  const value = hash(fold(text)) % 100;
  return value < YES_PERCENT ? 'yes' : value < YES_PERCENT + NO_PERCENT ? 'no' : 'maybe';
}

function moodOf(words) {
  const folded = words.map((word) => fold(word));
  const negated = folded.includes('nie');
  const good = folded.some((word) => GOOD_WORDS.test(word));
  const bad = folded.some((word) => BAD_WORDS.test(word));
  if (good && !bad) return negated ? 'bad' : 'good';
  if (bad && !good) return negated ? 'good' : 'bad';
  return 'plain';
}

const keyword = (words) => words.reduce((best, word) => {
  const folded = fold(word);
  return folded.length > fold(best).length && !STOPWORDS.has(folded) ? word : best;
}, '');

function fillVars(line, vars) {
  return line.replaceAll('{E}', () => vars.E).replaceAll('{e}', () => vars.e).replaceAll('{r}', () => vars.r)
    .replaceAll('{v}', () => vars.v).replaceAll('{I}', () => vars.I).replaceAll('{k}', () => vars.k);
}

/** A line from the list that its words fit: no {r} without a rest of the sentence, no echo of a sentence too long to repeat. */
function fit(lines, vars) {
  const fits = lines.filter((line) => (!vars.when || !/\bKiedy\b/.test(line)) && (vars.r || !line.includes('{r}')) && (vars.v || !line.includes('{v}')) && (vars.I || !line.includes('{I}'))
    && (vars.k || !line.includes('{k}')) && (vars.e && vars.e.length <= ECHO_MAX ? true : !/\{[Ee]\}/.test(line)));
  return fits.length ? fits : lines.filter((line) => !/\{[EerviIk]\}/.test(line));
}

/** Which list of `SAID_ABOUT_SELF` a sentence about the member takes. */
function selfList(parsed, rest) {
  const { group, negated } = parsed;
  if (group === 'be') {
    const mood = moodOf(rest);
    return negated ? 'be' : mood === 'good' ? 'beGood' : mood === 'bad' ? 'beBad' : 'be';
  }
  if (group === 'like') return negated ? 'likeNot' : 'like';
  if (group === 'hate') return 'hate';
  if (group === 'past') return negated ? 'pastNot' : 'past';
  const notList = { have: 'haveNot', want: 'wantNot', do: 'doNot', know: 'knowNot', can: 'canNot' }[group];
  return negated && notList ? notList : group;
}

/**
 * The answer to a sentence nothing more exact took: { line, skillId }, or null when it is too short to say anything.
 * `pick(lines, list)` picks a line, `topic` = a skill whose lines can follow the sentence, `catchSkill` = lines for a question that a catch-all fits.
 */
export function understand(parsed, { pick, random = Math.random, topic = null, catchSkill = null } = {}) {
  const { words, person, verb, index, question, asks, qSkill, group, asksBack } = parsed;
  if (!words.length || onlyCalls(parsed)) return null;
  if (findSlur(words.join(' '), PRESET_SLURS)) return { line: pick(WILL_NOT_REPEAT, 'wontRepeat'), skillId: 'unknown' };

  const rest = index >= 0 ? words.slice(index + 1) : [];
  const safe = Boolean(topic) || words.some((word) => SAFE_LIKES.test(fold(word)));
  // "Ja cię biję" with a verb it does not know would come back as "ty mnie biję": no echo then.
  const canEcho = index >= 0 || !words.some((word) => ['ja', 'ty', 'mnie', 'cie', 'ciebie'].includes(fold(word)));
  const e = canEcho ? reflect(words).join(' ') : '';
  // "Wczoraj grałem": no asking when.
  const when = words.some((word) => /^(dzis|dzisiaj|wczoraj|jutro|teraz|rano|wieczorem|przedwczoraj|zaraz)$/.test(fold(word)));
  const vars = { e, E: capital(e), r: reflect(rest).join(' '), v: verb?.you ?? '', I: verb?.me ?? '', k: keyword(words), when };
  const echo = e && e.length <= ECHO_MAX ? `${vars.E}? ` : '';
  const from = (lines, list) => fillVars(pick(fit(lines, vars), list), vars);
  const topicLine = () => (topic ? pick(topic.replies, topic.id) : null);

  if (qSkill) {
    if (words.length < 2) return null;
    const source = catchSkill?.id.startsWith('ask') || !catchSkill ? KLUBIS_SKILLS.find((skill) => skill.id === qSkill) : catchSkill;
    const line = pick(source.replies, source.id);
    return { line: random() < 0.6 ? `${echo}${line}` : line, skillId: qSkill };
  }

  // To Klubiś: "lubisz pizzę?" -> "Lubię pizzę? Pewnie!". The side stays the same for the same words.
  if (person === 'you') {
    if (question || asks) {
      // A yes to any words is how it got baited: only for what it can safely like.
      if (!safe) return { line: pick(ASKED_UNKNOWN, 'askedUnknown'), skillId: 'understood' };
      const side = sideOf(words.join(' '));
      const answer = random() < 0.3 ? topicLine() : null;
      const asked = asks ? echo : e && e.length <= ECHO_MAX ? `Czy ${e}? ` : '';
      return { line: `${asked}${answer ?? pick(side === 'no' ? ASKED_NO : ASKED_YES, `asked:${side === 'no' ? 'no' : 'yes'}`)}`, skillId: 'understood' };
    }
    const mood = moodOf(rest);
    const lines = mood === 'good' ? SAID_ABOUT_ME_GOOD : mood === 'bad' ? SAID_ABOUT_ME_BAD : SAID_ABOUT_ME;
    return { line: `${echo}${pick(lines, `aboutMe:${mood}`)}`, skillId: 'understood' };
  }

  // A yes or no question about anything else.
  if (question || asks) {
    const side = sideOf(words.join(' '));
    const lines = side === 'yes' ? ANSWER_YES : side === 'no' ? ANSWER_NO : ANSWER_MAYBE;
    const line = pick(lines, `question:${side}`);
    // Said back only about what is safe: "czy kuba ma ...?" must not come back with a yes under it.
    return { line: safe && random() < 0.4 ? `${echo}${line}` : line, skillId: 'question' };
  }

  if (words.length >= LONG_WORDS && vars.k) return { line: from(LONG_TEXT, 'longText'), skillId: 'understood' };

  // About the member: "gram w cs" -> "Grasz w cs? I jak ci idzie?".
  if (person === 'me') {
    const foldedRest = rest.map((word) => fold(word));
    const feeling = group === 'be' && !parsed.negated ? FEELINGS.find(([match]) => foldedRest.some((word) => match.test(word))) : null;
    if (feeling) return { line: `${echo}${pick(feeling[1], `feeling:${FEELINGS.indexOf(feeling)}`)}`, skillId: 'understood' };
    if (group === 'have' && !parsed.negated && foldedRest.some((word) => PERSON_WORDS.test(word))) return { line: from(HAVE_PERSON, 'havePerson'), skillId: 'understood' };
    const list = group === 'have' && !parsed.negated && moodOf(rest) === 'bad' ? 'beBad' : selfList(parsed, rest);
    if (topic && list !== 'beBad' && random() < 0.4) return { line: `${echo}${topicLine()}`, skillId: topic.id };
    const safeList = safe && SAID_ABOUT_SELF[`${list}Safe`] ? `${list}Safe` : list;
    const line = from(SAID_ABOUT_SELF[safeList] ?? SAID_OTHER, `self:${safeList}`);
    if (!asksBack) return { line, skillId: 'understood' };
    return { line: `${line} A ja? ${pick(sideOf(words.join(' ')) === 'no' ? ASKED_NO : ASKED_YES, 'askedBack')}`, skillId: 'understood' };
  }

  // "Zrób kanapkę" -> "Mam zrobić kanapkę? ...".
  const command = words.findIndex((word) => !FILLERS.has(fold(word)));
  const first = command >= 0 ? fold(words[command]) : '';
  const infinitive = COMMANDS[first] ?? (SAY_COMMANDS.has(first) ? first : null);
  if (infinitive && SAY_COMMANDS.has(fold(words[command]))) return { line: pick(ASKED_TO_SAY, 'askedToSay'), skillId: 'understood' };
  if (infinitive) {
    const asked = reflect(words.slice(command + 1)).join(' ');
    const said = `Mam ${infinitive}${asked ? ` ${asked}` : ''}?`;
    return { line: `${said.length <= ECHO_MAX ? `${said} ` : ''}${pick(ASKED_TO_DO, 'askedToDo')}`, skillId: 'understood' };
  }

  if (words.length === 1) return { line: from(ONE_WORD, 'oneWord'), skillId: 'understood' };
  if (words.some((word) => INSULT_WORDS.test(fold(word)))) return { line: from(SAID_INSULT, 'insult'), skillId: 'understood' };
  const mood = moodOf(words);
  if (mood === 'good') return { line: from(SAID_OTHER_GOOD, 'otherGood'), skillId: 'understood' };
  if (mood === 'bad') return { line: from(SAID_OTHER_BAD, 'otherBad'), skillId: 'understood' };
  if (topic && random() < 0.5) return { line: `${echo}${topicLine()}`, skillId: topic.id };
  return { line: from(SAID_OTHER, 'other'), skillId: 'understood' };
}

const SECRET = /\d{5,}|@|\b(haslo|pesel|adres|ulica|ulicy|ul|numer|telefon|nr|login|token)\b/;
const NOT_A_FACT = /^(cie|ciebie|cb|to|tego|tak|go|mnie|siebie|sie|tu|tam|cos|kogos|wszystko)\b/;

/**
 * What a sentence tells about the member: { name, age, city, likes, dislikes, plays }. Never a phone number, an address or a password:
 * Klubiś says what it knows on the channel, so those would end up in public.
 */
export function factsOf(parsed) {
  const facts = {};
  const { words, person, group, negated, index, question, asks, qSkill } = parsed;
  // "Mów mi Kacper", "nazywam się Ania".
  const called = /^(?:mow|nazywaj|wolaj) (?:mi|mnie)$|^nazywam sie$/.test(fold(words.slice(0, 2).join(' ')));
  if (called && words.length >= 3 && words.length <= 4 && !question && !findSlur(words.join(' '), PRESET_SLURS) && !touchyKind(words.join(' '))) {
    facts.name = words.slice(2).map(capital).join(' ');
    return facts;
  }
  if (person !== 'me' || question || asks || qSkill || parsed.past) return facts;
  const rest = words.slice(index + 1);
  const said = rest.join(' ');
  const folded = fold(said);
  if (!said || SECRET.test(folded) || findSlur(said, PRESET_SLURS) || touchyKind(said)) return facts;
  if ((group === 'like' || group === 'want') && rest.some((word) => LIKE_TOUCHY.test(fold(word)))) return facts;
  const short = said.length <= LIKE_MAX && rest.length <= FACT_WORDS_MAX;

  if (group === 'have') {
    if (/^na imie \S+( \S+)?$/.test(folded)) facts.name = rest.slice(2).map(capital).join(' ');
    const age = /^(\d{1,2}) (lat|lata|latek)$/.exec(folded);
    if (age && !negated && Number(age[1]) >= 5) facts.age = Number(age[1]);
  } else if (group === 'be' && /^z \S+( \S+)?$/.test(folded)) {
    facts.city = `z ${rest.slice(1).map(capital).join(' ')}`;
  } else if (group === 'live' && /^(w|we|na) \S+( \S+)?$/.test(folded) && fold(words[index]) === 'mieszkam') {
    facts.city = `${fold(rest[0])} ${rest.slice(1).map(capital).join(' ')}`;
  } else if (short && !NOT_A_FACT.test(folded)) {
    if (group === 'like' && !negated && fold(words[index]) !== 'kocham') facts.likes = said;
    if ((group === 'like' && negated) || group === 'hate') facts.dislikes = said;
    if (group === 'play' && !negated) facts.plays = said;
  }
  return facts;
}

// "Zapamiętaj, że ...", "możesz zapamiętać, że ...".
const REMEMBER_THIS = /^(?:a |no |ale )?(?:czy )?(?:ty )?(?:mozesz |umiesz |potrafisz |musisz |prosze )?(?:sobie )?(?:zapamietac|zapamietaj|zapamietasz|zapisz|zanotuj|pamietaj|zapisz sobie)(?: sobie)?(?: ze| to| o tym ze)?\b/;
// "Jestem w związku z @Kuba", "chodzę z Anią", "moja dziewczyna to Ania", "mój chłopak to @Kuba".
const PARTNER_SAID = /^(?:ja )?(?:(?:jestem|bede|jestesmy)(?: teraz)? (?:w zwiazku|po slubie|zareczon\w*) z|chodze z|spotykam sie z|mam dziewczyne|mam chlopaka|mam zone|mam meza|moja (?:dziewczyna|zona|partnerka|ukochana) to|moj (?:chlopak|maz|partner|ukochany) to)\b/;

/** Words kept with their mentions, so "@Kuba" stays who it is. */
const wordsWithMentions = (raw) => String(raw ?? '').replace(/https?:\S+/gi, ' ').replace(/klubi[sś]\p{L}*/giu, ' ').replace(/[`*_~|#{}\\"„”“«»]/g, '').replace(/[?!.…;:,]+/g, ' ').split(/\s+/).filter(Boolean);

/** What is said to remember or about a partner, kept as said back: { partner, note, loves }. Touchy words and secrets never get here. */
export function relationshipOf(raw) {
  const words = wordsWithMentions(raw);
  const text = fold(cleanText(raw));
  if (touchyKind(text) || SECRET.test(fold(words.join(' ')).replace(/\d{15,22}/g, ''))) return {};
  const folded = words.map((word) => (/^<@/.test(word) ? word : fold(word)));
  const joined = folded.join(' ');

  const remember = REMEMBER_THIS.exec(joined);
  if (remember) {
    const count = remember[0].trim().split(' ').length;
    const inner = words.slice(count);
    if (!inner.length || inner.join(' ').length > NOTE_MAX) return {};
    const said = reflect(inner).join(' ');
    return { note: said, ...relationshipOf(inner.join(' ')) };
  }
  const partner = PARTNER_SAID.exec(joined);
  if (partner && words.length > partner[0].trim().split(' ').length && words.length <= PARTNER_WORDS_MAX) return { partner: capital(reflect(words).join(' ')) };

  // "Kocham szeldis", "kocham @Kuba".
  if (/^(?:a |no |ja |tez |bardzo )*kocham\b/.test(joined)) {
    const at = folded.indexOf('kocham');
    const who = words.slice(at + 1).filter((word) => !['a', 'ty'].includes(fold(word)));
    const name = who.join(' ');
    if (who.length && who.length <= FACT_WORDS_MAX && !NOT_A_FACT.test(fold(name))) return { loves: name };
  }
  // "Jestem z @Kuba": with a mention it is a person, not a town.
  if (/^(?:ja )?jestem z <@/.test(joined)) return { partner: capital(reflect(words).join(' ')) };
  return {};
}

/**
 * A sentence a member says about themselves, kept as said back ("masz psa", "twój pies ma na imię Burek", "byłaś w kinie"), for the notebook.
 * Null for questions, for anything short or long, and for what must not be kept.
 */
export function notebookLine(parsed) {
  const { words, person, question, asks, qSkill } = parsed;
  const aboutMine = /^(moj|moja|moje|moi|moich|moim|moją)$/.test(fold(words[0] ?? ''));
  if ((person !== 'me' && !aboutMine) || question || asks || qSkill) return null;
  if (words.length < 2 || words.length > NOTEBOOK_WORDS) return null;
  const text = words.join(' ');
  if (SECRET.test(fold(text)) || touchyKind(text) || findSlur(text, PRESET_SLURS)) return null;
  return reflect(words).join(' ');
}

const NOT_SEARCHED = /^(czy|co|kto|gdzie|kiedy|jak|jaki|jaka|jakie|ile|mam|moj|moja|moje|ja|mi|mnie|byl|bylem|bylam|sie|to|jest|nie|tak|a|i|w|na|do|z|ze|o)$/;
/** A question about the member, answered from the notebook: "jak ma na imię mój pies?", "czy mam psa?". Null when nothing fits. */
export function searchNotebook(text, parsed, member, pick) {
  const list = [...(member?.said ?? []), ...(member?.notes ?? [])];
  if (!list?.length || !(parsed.question || parsed.asks || parsed.qSkill)) return null;
  // About the member: "mój", "ja", or a verb in the first person ("gdzie pracuję", "gdzie byłam").
  const asked = text.split(' ');
  if (!asked.some((word) => /^(moj|moja|moje|mojego|mojej|moim|moich|ja|mnie|mi)$/.test(word) || VERBS_ME.has(word) || isPastMe(word))) return null;
  const stems = text.split(' ').filter((word) => !NOT_SEARCHED.test(word) && word.length >= 3).map(wordStem);
  if (!stems.length) return null;
  let best = null;
  for (const line of list) {
    const tokens = fold(line).split(' ');
    const hits = stems.filter((stem) => tokens.some((token) => stemFits(stem, token))).length;
    // Newer sentences come later, so they win a tie.
    if (hits && hits >= (best?.hits ?? 0)) best = { hits, line };
  }
  return best ? capital(pick(RECALLED.said, 'recalled:said').replaceAll('{x}', () => best.line)) : null;
}

/** "Lubię grać w minecraft, a ty?" -> "grać w minecraft". */
export const likeOf = (raw) => factsOf(parseSentence(raw)).likes ?? null;

/** The line for a member who just said who they are, or null. */
export function learnedLine(facts, pick) {
  for (const key of ['partner', 'loves', 'note', 'name', 'age', 'city']) {
    if (facts[key]) return capital(pick(LEARNED[key], `learned:${key}`).replaceAll('{x}', () => (key === 'age' ? yearsOld(facts[key]) : String(facts[key]))));
  }
  return null;
}

/** "Jak mam na imię?", "ile mam lat?", "co lubię?": from the member's memory. Null when the message asks none of these. */
export function recalledLine(text, member, pick) {
  const asked = /\bkogo (ja )?kocham\b|\bkto jest moja milosc\b|\bkogo lubie\b/.test(text) ? 'loves'
    : /\bz kim (ja )?(jestem|chodze|sie spotykam)\b|\bkto jest moim? (chlopakiem|mezem|partnerem)\b|\bkto jest moja (dziewczyna|zona|partnerka)\b|\bmam (dziewczyne|chlopaka|zone|meza)\b/.test(text) ? 'partner'
      : /\bco (sobie )?(zapamietales|zapisales|masz zapisane|masz w notesie)\b/.test(text) ? 'notes'
        : /\bjak (mam na imie|sie nazywam)\b|\bmoje imie\b/.test(text) ? 'name'
    : /\bile mam lat\b/.test(text) ? 'age'
      : /\bskad jestem\b|\bgdzie mieszkam\b/.test(text) ? 'city'
        : /\bczego nie lubie\b/.test(text) ? 'dislikes'
          : /\bco lubie\b/.test(text) ? 'likes'
            : /\bw co gram\b/.test(text) ? 'plays' : null;
  if (!asked) return null;
  // Nothing said with "zapamiętaj": the newest sentences of the notebook.
  const value = asked === 'notes' && !member?.notes?.length ? member?.said?.slice(-3) : member?.[asked];
  const shown = Array.isArray(value) ? value.join(asked === 'notes' ? '; ' : ', ') : asked === 'age' && value ? yearsOld(value) : value;
  if (!shown) return pick(RECALLED.unknown, 'recalled:unknown');
  return capital(pick(RECALLED[asked], `recalled:${asked}`).replaceAll('{x}', () => String(shown)));
}
