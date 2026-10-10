// commandLocalizations.js — Polish descriptions for slash commands.
//
// Discord shows a command's description in the language of the *user's* Discord
// client. The English text in each command file stays the default; this adds the
// Polish version from the dictionary so Polish clients see Polish.

import { hasTranslation, tl } from './index.js';

const DESCRIPTION_LIMIT = 100;
const CHOICE_NAME_LIMIT = 100;

function localized(text, limit) {
  if (typeof text !== 'string' || !hasTranslation(text, 'pl')) return null;
  const translated = tl('pl', text);
  if (!translated || translated === text) return null;
  return translated.length > limit ? `${translated.slice(0, limit - 1)}…` : translated;
}

function localizeNode(node) {
  const description = localized(node.description, DESCRIPTION_LIMIT);
  if (description) {
    node.description_localizations = { ...(node.description_localizations ?? {}), pl: description };
  }

  for (const choice of node.choices ?? []) {
    const name = localized(choice.name, CHOICE_NAME_LIMIT);
    if (name) choice.name_localizations = { ...(choice.name_localizations ?? {}), pl: name };
  }

  for (const option of node.options ?? []) localizeNode(option);
}

/** Add Polish description/choice localizations to a command payload (mutates and returns it). */
export function localizeCommandJson(json) {
  localizeNode(json);
  return json;
}

/** Every English description and choice name used by a command payload. */
export function collectCommandTexts(json, out = new Set()) {
  if (json.description) out.add(json.description);
  for (const choice of json.choices ?? []) {
    if (typeof choice.name === 'string' && /\p{L}{2,}/u.test(choice.name)) out.add(choice.name);
  }
  for (const option of json.options ?? []) collectCommandTexts(option, out);
  return out;
}
