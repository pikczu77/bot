// klubisKnowledge.js — what Klubiś knows, and finding it in a question (2026-11-01). Texts: config/klubisKnowledge.js and klubisKnowledgeData.js,
// plus the questions of the quiz and of the question of the day. Polish words change their endings, so everything is matched by the beginning
// of a folded word. The entry that matches the most words wins.

import { CAPITALS, FACTS, NAMED, RECIPES } from '../config/klubisKnowledge.js';
import { SMP_GROUPS, SMP_ITEMS, SMP_RECIPES } from '../config/klubisKnowledgeData.js';
import { QUIZ_QUESTIONS } from '../config/quizQuestions.js';
import { DAILY_TRIVIA } from '../config/chatPrompts.js';
import { STOPWORDS } from '../config/klubisGrammar.js';
import { fold, stemFits, wordStem } from './klubisBrain.js';

const MAKE = 'craft|zrobi|stworz|przepis|wytworz|zbudowa|skraft|recept';
// The question is about what something is.
const ASKS_WHAT = /^(a |no |ale )?(co to|co to jest|czym jest|czym sa|kto to|kto to jest|kim jest|kim byl|kim byla|co wiesz o|opowiedz o|opowiedz mi o|powiedz o|powiedz mi o|powiedz cos o|jak dziala|jak dzialaja|co robi|co robia|co daje|co dają|do czego|znasz|wytlumacz|wyjasnij|co oznacza|co znaczy|ile kosztuje|gdzie znajde|gdzie znalezc|skad wziac|jak zdobyc|gdzie kupic|jak uzywac|jak grac)\b/;
const ASKS_MAKE = new RegExp(`\\b(${MAKE})`);
const MIN_QUIZ_WORDS = 3;
const QUIZ_SHARE = 0.75;

/** 'stolic franc|=usa' into groups of alternatives. */
const groupsOf = (words) => words.split(' ').map((group) => group.split('|').map((alt) => (alt.startsWith('=') ? { exact: alt.slice(1) } : { prefix: alt })));
const altFits = (alt, token) => (alt.exact ? token === alt.exact : stemFits(alt, token));

function groupsScore(groups, tokens) {
  let score = 0;
  for (const group of groups) {
    const fits = group.filter((alt) => tokens.some((token) => altFits(alt, token)));
    if (!fits.length) return 0;
    score += 10 + Math.max(...fits.map((alt) => (alt.exact ?? alt.prefix).length));
  }
  return score;
}

/** The stems of a name's words, so every case fits: "Miecz Boga" takes "miecza bogów". Short words ("z", "na") do not count. */
function stemsOf(name) {
  return fold(name).split(' ').filter((word) => word.length > 2 && !STOPWORDS.has(word)).map(wordStem);
}

const named = NAMED.map(([forms, text]) => ({
  forms: forms.split('|').map((form) => form.trim().split(' ').map((word) => (word.startsWith('=') ? { exact: word.slice(1) } : { prefix: word }))),
  text,
}));
const smpNamed = [...SMP_GROUPS, ...SMP_ITEMS].map((item) => ({ stems: stemsOf(item.name), text: item.text })).filter((item) => item.stems.length);
const smpRecipes = SMP_RECIPES.map((item) => ({ stems: stemsOf(item.name), text: item.text })).filter((item) => item.stems.length);

const facts = [
  ...FACTS.map(([words, text]) => ({ groups: groupsOf(words), text })),
  ...CAPITALS.map(([country, name, capital]) => ({ groups: groupsOf(`stolic ${country}`), text: `Stolica ${name} to ${capital} 🌍` })),
  ...RECIPES.map(([item, text]) => ({ groups: groupsOf(`${MAKE} ${item}`), text: `${text} 🛠️` })),
];

const quiz = [
  ...QUIZ_QUESTIONS.map(({ q, a }) => ({ stems: stemsOf(q), answer: a[0] })),
  ...DAILY_TRIVIA.map(({ q, a }) => ({ stems: stemsOf(q), answer: a[0] })),
].filter((item) => item.stems.length >= MIN_QUIZ_WORDS);

const stemsFit = (stems, tokens) => stems.every((stem) => tokens.some((token) => altFits(stem, token)));
const stemsLength = (stems) => stems.reduce((sum, stem) => sum + 10 + stem.prefix.length, 0);

/**
 * The answer in Klubiś's knowledge, or null. `parsed` = parseSentence: a sentence about the member ("mam miecz boga") asks nothing,
 * and a question to Klubiś about itself ("lubisz creepery?") is not a question about creepers.
 */
export function knowledgeAnswer(text, parsed) {
  const asks = parsed.question || parsed.asks || parsed.qSkill;
  const asksWhat = ASKS_WHAT.test(text);
  if (parsed.person === 'me' && !asks) return null;
  if (parsed.person === 'you' && !asksWhat) return null;
  const short = parsed.words.length <= 3;
  if (!asks && !asksWhat && !short) return null;

  const tokens = text.split(' ').filter(Boolean);
  let best = null;
  const offer = (score, answer) => { if (score > (best?.score ?? 0)) best = { score, answer }; };

  for (const fact of facts) offer(groupsScore(fact.groups, tokens), fact.text);
  // A name alone means "what is it"; a name inside a longer question needs the question to be about it.
  if (asksWhat || short || asks) {
    for (const entry of named) {
      for (const form of entry.forms) if (form.every((part) => tokens.some((token) => altFits(part, token)))) offer(form.reduce((sum, part) => sum + 5 + (part.exact ?? part.prefix).length, 0), entry.text);
    }
    for (const item of smpNamed) if ((asksWhat || short || item.stems.length > 1) && stemsFit(item.stems, tokens)) offer(stemsLength(item.stems), item.text);
  }
  // A recipe beats the item itself: 'jak zrobić czekan'.
  if (ASKS_MAKE.test(text)) for (const item of smpRecipes) if (stemsFit(item.stems, tokens)) offer(stemsLength(item.stems) + 30, item.text);

  if (asks) {
    for (const item of quiz) {
      const hits = item.stems.filter((stem) => tokens.some((token) => altFits(stem, token))).length;
      if (hits / item.stems.length >= QUIZ_SHARE) offer(hits * 12, `${String(item.answer)[0].toLocaleUpperCase('pl')}${String(item.answer).slice(1)} 🧠`);
    }
  }
  return best?.answer ?? null;
}

/** Does this message ask the question running now? Klubiś must not give away what a quiz pays for. */
export function asksLiveQuestion(text, question) {
  const stems = stemsOf(question);
  if (stems.length < 2) return false;
  const tokens = text.split(' ').filter(Boolean);
  return stems.filter((stem) => tokens.some((token) => altFits(stem, token))).length / stems.length >= 0.5;
}
