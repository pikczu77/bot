// i18n/index.js — gettext-style translations keyed by the English source text.
//
//   t`Banned ${user.tag}`         tagged template  -> key "Banned {0}"
//   t('No reason provided')       plain call       -> key "No reason provided"
//   t(dynamicEnglishString)       runtime lookup of a string defined elsewhere
//
// The active language comes from an AsyncLocalStorage context that is entered once
// per event / interaction / scheduled guild task (see runWithLocale). Outside any
// context t() returns English, and tr() translates such strings later when they
// reach an output sink (embed, button label, reply content).

import { AsyncLocalStorage } from 'node:async_hooks';
import pl from './locales/pl.js';
import en from './locales/en.js';

export const SUPPORTED_LOCALES = ['pl', 'en'];

export const LOCALE_INFO = {
  pl: { name: 'Polski', flag: '🇵🇱', discord: ['pl'], intl: 'pl-PL' },
  en: { name: 'English', flag: '🇬🇧', discord: ['en-US', 'en-GB'], intl: 'en-GB' },
};

export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const short = value.trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LOCALES.includes(short) ? short : null;
}

export const DEFAULT_LOCALE = normalizeLocale(process.env.DEFAULT_LANGUAGE) || 'pl';

const dictionaries = { pl, en };
const storage = new AsyncLocalStorage();
const templateKeyCache = new WeakMap();

// English strings produced outside a locale context (module scope constants built
// from templates) so tr() can still translate them when they are finally sent.
const DEFERRED_LIMIT = 4000;
const deferred = new Map();

// Static English strings created outside a locale context (module-scope constants such
// as job names or menu labels). They are translated when interpolated into a translated
// template and when they reach an output sink.
const moduleStrings = new Set();

// Keys requested in a non-English locale that have no translation (for diagnostics).
const missing = new Set();

export function currentLocale() {
  return storage.getStore()?.locale ?? null;
}

/** Locale to use for output right now (falls back to the bot default). */
export function activeLocale() {
  return currentLocale() ?? DEFAULT_LOCALE;
}

export function runWithLocale(locale, callback) {
  return storage.run({ locale: normalizeLocale(locale) ?? DEFAULT_LOCALE }, callback);
}

/**
 * Enter a language for the rest of the current async flow. For loops over guilds in
 * scheduled jobs, where wrapping each iteration in runWithLocale would be awkward.
 */
export function enterLocale(locale) {
  storage.enterWith({ locale: normalizeLocale(locale) ?? DEFAULT_LOCALE });
}

/** Switch the language for the rest of the current async flow (e.g. after /language). */
export function switchLocale(locale) {
  const normalized = normalizeLocale(locale);
  const store = storage.getStore();
  if (normalized && store) {
    store.locale = normalized;
  }
}

function templateKey(strings) {
  let key = templateKeyCache.get(strings);
  if (key === undefined) {
    key = '';
    for (let i = 0; i < strings.length; i += 1) {
      key += strings[i];
      if (i < strings.length - 1) key += `{${i}}`;
    }
    templateKeyCache.set(strings, key);
  }
  return key;
}

function pluralIndex(locale, count, formCount) {
  const n = Math.abs(Number(count));
  if (!Number.isFinite(n)) return formCount - 1;
  if (locale === 'pl' && formCount >= 3) {
    if (n === 1) return 0;
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (Number.isInteger(n) && mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 1;
    return 2;
  }
  return n === 1 ? 0 : Math.min(1, formCount - 1);
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/[^\d.,-]/g, '').replace(/[\s,](?=\d{3}\b)/g, '').replace(',', '.');
  return Number.parseFloat(cleaned);
}

// {0} inserts a value; {0|one|few|many} picks a plural form by that value.
const PLACEHOLDER_RE = /\{(\d+)(?:\|([^{}]*))?\}/g;

function format(template, values, locale) {
  if (!values.length && !template.includes('|')) return template;
  return template.replace(PLACEHOLDER_RE, (match, indexText, forms) => {
    const index = Number(indexText);
    if (index >= values.length) return forms === undefined ? match : forms.split('|')[0];
    const value = values[index];
    if (forms === undefined) {
      if (typeof value === 'string' && locale !== 'en' && moduleStrings.has(value)) {
        const translated = dictionaries[locale]?.[value];
        if (typeof translated === 'string') return translated;
      }
      return String(value ?? '');
    }
    const options = forms.split('|');
    return options[pluralIndex(locale, toNumber(value), options.length)] ?? options[options.length - 1];
  });
}

function lookup(locale, key) {
  const dictionary = dictionaries[locale];
  const translated = dictionary?.[key];
  if (typeof translated === 'string') return translated;
  if (locale !== 'en' && key && /\p{L}/u.test(key)) missing.add(key);
  const english = dictionaries.en[key];
  return typeof english === 'string' ? english : key;
}

/**
 * Translate. Works as a template tag or as a plain function:
 *   t`Level ${level} reached`      t('Level {0} reached', level)
 */
export function t(first, ...values) {
  const key = Array.isArray(first) && Array.isArray(first.raw) ? templateKey(first) : String(first ?? '');
  if (!key) return '';

  const locale = currentLocale();
  if (!locale) {
    const english = format(lookup('en', key), values, 'en');
    if (values.length === 0) {
      moduleStrings.add(english);
    } else if (english !== key) {
      if (deferred.size >= DEFERRED_LIMIT) deferred.delete(deferred.keys().next().value);
      deferred.set(english, { key, values });
    }
    return english;
  }

  return format(lookup(locale, key), values, locale);
}

/** Translate with an explicit locale (ignores the ambient context). */
export function tl(locale, key, ...values) {
  const target = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  return format(lookup(target, String(key ?? '')), values, target);
}

/** Marks a string for extraction without translating it (module-scope constants). */
export function N_(text) {
  return text;
}

/**
 * Sink translation: translate an English string that was built outside a language
 * context (module-scope constants, config defaults). Only strings the bot itself
 * produced that way are touched, so user-written text is never altered.
 */
export function tr(text, locale = currentLocale()) {
  if (typeof text !== 'string' || !text) return text;
  const target = locale ?? DEFAULT_LOCALE;
  const dictionary = dictionaries[target];

  if (moduleStrings.has(text)) {
    const direct = dictionary?.[text];
    return typeof direct === 'string' ? format(direct, [], target) : text;
  }

  const pending = deferred.get(text);
  if (pending) {
    const template = dictionary?.[pending.key];
    if (typeof template === 'string') return format(template, pending.values, target);
  }

  if (target !== 'en' && text.includes('\n')) {
    // Multi-line text assembled from constants: translate the lines we recognise.
    let changed = false;
    const lines = text.split('\n').map((line) => {
      const translated = moduleStrings.has(line) ? dictionary?.[line] : undefined;
      if (typeof translated === 'string') {
        changed = true;
        return format(translated, [], target);
      }
      return line;
    });
    if (changed) return lines.join('\n');
  }

  return text;
}

let reverseIndex = null;

function getReverseIndex() {
  if (!reverseIndex) {
    reverseIndex = new Map();
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale] ?? {})) {
        if (typeof value === 'string' && !reverseIndex.has(value)) reverseIndex.set(value, key);
      }
    }
  }
  return reverseIndex;
}

/**
 * Translate a known bot text between languages in either direction. Use where a
 * built-in default (welcome template, level-up message, button text) may have been
 * saved in one language and is now shown in another. Custom text is returned as is.
 */
export function trAny(text, locale = currentLocale()) {
  if (typeof text !== 'string' || !text) return text;
  const target = locale ?? DEFAULT_LOCALE;
  const key = Object.hasOwn(dictionaries.pl, text) ? text : getReverseIndex().get(text);
  if (!key) return text;
  return format(lookup(target, key), [], target);
}
const COMPARE_NOISE_RE = /[\p{Extended_Pictographic}️‍]/gu;

function normalizeForCompare(text) {
  return String(text ?? '').replace(COMPARE_NOISE_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * True when `actual` (text read back from an existing message) is `key` in any
 * supported language. Use instead of `=== 'English text'` on embed titles/fields.
 */
export function sameText(actual, key) {
  const target = normalizeForCompare(actual);
  if (!target) return false;
  if (normalizeForCompare(key) === target) return true;
  return SUPPORTED_LOCALES.some((locale) => {
    const translated = dictionaries[locale]?.[key];
    return typeof translated === 'string' && normalizeForCompare(translated) === target;
  });
}

export function hasTranslation(key, locale = 'pl') {
  return typeof dictionaries[locale]?.[key] === 'string';
}

export function getMissingKeys() {
  return [...missing];
}

/** Number formatted for the active language (1 234 in Polish, 1,234 in English). */
export function fmtNumber(value, options) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return new Intl.NumberFormat(LOCALE_INFO[activeLocale()].intl, options).format(number);
}

// ---------------------------------------------------------------------------
// Guild language cache. Persistence lives in services/languageService.js; this
// module stays dependency-free so every other file can import it safely.
// ---------------------------------------------------------------------------

const guildLocales = new Map();

export function getCachedGuildLocale(guildId) {
  return guildId ? guildLocales.get(String(guildId)) ?? null : null;
}

export function cacheGuildLocale(guildId, locale) {
  if (!guildId) return;
  guildLocales.set(String(guildId), normalizeLocale(locale) ?? DEFAULT_LOCALE);
}

export function forgetGuildLocale(guildId) {
  guildLocales.delete(String(guildId));
}

/** Language of a Discord client locale string such as "pl" or "en-US". */
export function localeFromDiscord(discordLocale) {
  return normalizeLocale(discordLocale);
}
