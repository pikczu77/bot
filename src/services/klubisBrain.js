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
  SAID_OTHER_BAD, SAID_OTHER_GOOD, STOPWORDS, VERB_GROUPS, WILL_NOT_REPEAT,
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
const FACT_WORDS_MAX = 5;

const VERBS_ME = new Map();
const VERBS_YOU = new Map();
for (const [group, pairs] of Object.entries(VERB_GROUPS)) {
  for (const [me, you] of pairs) {
    VERBS_ME.set(fold(me), { group, me, you });
    VERBS_YOU.set(fold(you), { group, me, you });
  }
}

const pastEnding = (word, endings) => endings.some((ending) => word.endsWith(ending));
const isPast = (word, previous, endings) => {
  if (word.length < 5 || NOT_PAST.has(word) || PREPOSITIONS.has(previous) || !pastEnding(word, endings)) return false;
  const stem = word.slice(0, -2);
  return /[aeiouy]l$/.test(stem) || PAST_STEMS.test(stem);
};
const isPastMe = (word, previous = '') => isPast(word, previous, ['em', 'am']);
const isPastYou = (word, previous = '') => isPast(word, previous, ['es', 'as']);

/**
 * A message Klubiś must not say back or agree with: 'touchy', 'hit' (someone hitting it or someone else), or null. Klubiś repeats words, so anybody
 * could make it say anything otherwise. It only reads folded words, so it also misses things: the answers that agree are limited too (`SAFE_LIKES`).
 */
export function touchyKind(text) {
  const tokens = fold(text).split(' ').filter(Boolean);
  if (tokens.some((word) => TOUCHY_WORDS.test(word))) return /\bdzien dziecka\b/.test(tokens.join(' ')) ? null : 'touchy';
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
export const isVerbWord = (word) => VERBS_ME.has(word) || VERBS_YOU.has(word) || isPastMe(word) || isPastYou(word);

/** The message only calls Klubiś: "ej", "halo", nothing else that means anything. */
export const onlyCalls = (parsed) => parsed.words.every((word) => FILLERS.has(fold(word)) || JUST_CALLING.has(fold(word)) || GREETINGS.has(fold(word)));

const capital = (text) => (text ? text[0].toLocaleUpperCase('pl') + text.slice(1) : text);

/** The member's words without mentions, links, Klubiś's name or Discord formatting. */
export const cleanText = (raw) => String(raw ?? '').replace(MENTION_RE, ' ').replace(/https?:\S+/gi, ' ').replace(/klubi[sś]\p{L}*/giu, ' ')
  .replace(/[`*_~|>#@<{}\\"„”“«»]/g, '').replace(/\s+/g, ' ').replace(/^[\s,.:;!?-]+/, '').trim();

/** The words said from the other side: I becomes you and you becomes I, verbs and pronouns too. Klubiś's own past forms are masculine. */
export function reflect(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i];
    const word = fold(raw);
    const previous = i ? fold(words[i - 1]) : '';
    const pair = i + 1 < words.length ? PRONOUN_PAIRS[`${word} ${fold(words[i + 1])}`] : null;
    if (pair) {
      out.push(pair);
      i += 1;
    } else if (VERBS_ME.has(word)) out.push(VERBS_ME.get(word).you);
    else if (VERBS_YOU.has(word)) out.push(VERBS_YOU.get(word).me);
    else if (isPastMe(word, previous)) out.push(`${raw.slice(0, -3)}ł${word.endsWith('em') ? 'eś' : 'aś'}`);
    else if (isPastYou(word, previous)) out.push(`${raw.slice(0, -3)}łem`);
    else if (PRONOUNS[word]) out.push(raw.endsWith('ą') ? PRONOUNS[word].replace(/a$/, 'ą') : PRONOUNS[word]);
    else out.push(raw);
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

  for (let i = parsed.asks ? folded.indexOf('czy') + 1 : 0; i < Math.min(folded.length, 7); i += 1) {
    const word = folded[i];
    if (word === 'nie') {
      parsed.negated = true;
    } else if (!FILLERS.has(word)) {
      const previous = i ? folded[i - 1] : '';
      if (VERBS_ME.has(word) || VERBS_YOU.has(word)) {
        parsed.verb = VERBS_ME.get(word) ?? VERBS_YOU.get(word);
        parsed.group = parsed.verb.group;
        parsed.person = VERBS_ME.has(word) ? 'me' : 'you';
        parsed.index = i;
      } else if (isPastMe(word, previous) || isPastYou(word, previous)) {
        parsed.past = true;
        parsed.group = 'past';
        parsed.person = isPastMe(word, previous) ? 'me' : 'you';
        parsed.index = i;
      }
      break;
    }
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
      const asked = fold(words[0]) === 'czy' ? echo : e && e.length <= ECHO_MAX ? `Czy ${e}? ` : '';
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
    if (group === 'like' && !negated) facts.likes = said;
    if ((group === 'like' && negated) || group === 'hate') facts.dislikes = said;
    if (group === 'play' && !negated) facts.plays = said;
  }
  return facts;
}

/** "Lubię grać w minecraft, a ty?" -> "grać w minecraft". */
export const likeOf = (raw) => factsOf(parseSentence(raw)).likes ?? null;

/** The line for a member who just said who they are, or null. */
export function learnedLine(facts, pick) {
  for (const key of ['name', 'age', 'city']) {
    if (facts[key]) return capital(pick(LEARNED[key], `learned:${key}`).replaceAll('{x}', () => String(facts[key])));
  }
  return null;
}

/** "Jak mam na imię?", "ile mam lat?", "co lubię?": from the member's memory. Null when the message asks none of these. */
export function recalledLine(text, member, pick) {
  const asked = /\bjak (mam na imie|sie nazywam)\b|\bmoje imie\b/.test(text) ? 'name'
    : /\bile mam lat\b/.test(text) ? 'age'
      : /\bskad jestem\b|\bgdzie mieszkam\b/.test(text) ? 'city'
        : /\bczego nie lubie\b/.test(text) ? 'dislikes'
          : /\bco lubie\b/.test(text) ? 'likes'
            : /\bw co gram\b/.test(text) ? 'plays' : null;
  if (!asked) return null;
  const value = member?.[asked];
  const shown = Array.isArray(value) ? value.join(', ') : value;
  if (!shown) return pick(RECALLED.unknown, 'recalled:unknown');
  return capital(pick(RECALLED[asked], `recalled:${asked}`).replaceAll('{x}', () => String(shown)));
}
