import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { runWithLocale, t, tr, trAny, sameText, tl, currentLocale, fmtNumber } from '../src/i18n/index.js';
import { localizeBody } from '../src/i18n/discordSink.js';
import { extractKeys, loadDictionary } from '../scripts/i18n-extract.js';

const inPolish = (fn) => runWithLocale('pl', fn);
const inEnglish = (fn) => runWithLocale('en', fn);

test('tagged templates translate with values in place', () => {
  assert.equal(inEnglish(() => t`Log channel set to ${'#logs'}.`), 'Log channel set to #logs.');
  assert.equal(inPolish(() => t`Log channel set to ${'#logs'}.`), 'Kanał logów ustawiony na #logs.');
  assert.equal(inPolish(() => t('Cancel')), 'Anuluj');
});

test('unknown text falls back to English instead of breaking', () => {
  assert.equal(inPolish(() => t`Zzz not in the dictionary ${42}`), 'Zzz not in the dictionary 42');
  assert.equal(inPolish(() => t('')), '');
});

test('plural forms follow the language', () => {
  const invites = (count) => t`🎯 **${count}** {0|invite|invites}`;
  assert.equal(inEnglish(() => invites(1)), '🎯 **1** invite');
  assert.equal(inEnglish(() => invites(5)), '🎯 **5** invites');
  assert.equal(inPolish(() => invites(1)), '🎯 **1** zaproszenie');
  assert.equal(inPolish(() => invites(3)), '🎯 **3** zaproszenia');
  assert.equal(inPolish(() => invites(5)), '🎯 **5** zaproszeń');
  assert.equal(inPolish(() => invites(12)), '🎯 **12** zaproszeń');
  assert.equal(inPolish(() => invites(22)), '🎯 **22** zaproszenia');
  assert.equal(inPolish(() => invites(0)), '🎯 **0** zaproszeń');
});

test('language context survives awaits and does not leak between flows', async () => {
  const results = await Promise.all([
    runWithLocale('pl', async () => { await new Promise((r) => setTimeout(r, 15)); return [currentLocale(), t('Cancel')]; }),
    runWithLocale('en', async () => { await new Promise((r) => setTimeout(r, 5)); return [currentLocale(), t('Cancel')]; }),
  ]);
  assert.deepEqual(results, [['pl', 'Anuluj'], ['en', 'Cancel']]);
  assert.equal(currentLocale(), null);
});

test('module-scope constants are translated when they are sent', () => {
  // Built outside any language context, exactly like a constant at the top of a file.
  const LABEL = t('Refresh');
  assert.equal(LABEL, 'Refresh');
  assert.equal(inPolish(() => tr(LABEL)), 'Odśwież');
  assert.equal(inEnglish(() => tr(LABEL)), 'Refresh');
  // ...and when interpolated into a translated sentence.
  const ROLE = t('Moderator');
  assert.equal(inPolish(() => t`User ${ROLE}`), 'Użytkownik Moderator');
});

test('text written by server staff is never altered by the sink', () => {
  // "Support" is not something the bot produced at module scope, so it stays as typed.
  assert.equal(inPolish(() => tr('Totally custom panel title')), 'Totally custom panel title');
});

test('outgoing message bodies are localized in place', () => {
  const title = t('Refresh');
  const body = {
    content: t('Refresh'),
    embeds: [new EmbedBuilder().setTitle(title).setDescription('free text').toJSON()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('x').setLabel(title).setStyle(ButtonStyle.Primary),
    ).toJSON()],
  };
  inPolish(() => localizeBody(body));
  assert.equal(body.content, 'Odśwież');
  assert.equal(body.embeds[0].title, 'Odśwież');
  assert.equal(body.embeds[0].description, 'free text');
  assert.equal(body.components[0].components[0].label, 'Odśwież');
});

test('default templates translate both ways, custom ones stay', () => {
  const english = 'Welcome {user} to {server}!';
  const polish = inPolish(() => trAny(english));
  assert.equal(polish, 'Witaj {user} na {server}!');
  assert.equal(inEnglish(() => trAny(polish)), english);
  assert.equal(inPolish(() => trAny('Siema {user}, wbijaj!')), 'Siema {user}, wbijaj!');
});

test('sameText recognises a title in any language, with or without emoji', () => {
  assert.ok(sameText('Ticket Closed', 'Ticket Closed'));
  assert.ok(sameText(tl('pl', 'Ticket Closed'), 'Ticket Closed'));
  assert.ok(sameText('📋 Kategorie zdarzeń', '📋 Event Categories'));
  assert.ok(sameText('Event Categories', '📋 Event Categories'));
  assert.ok(!sameText('Something else', 'Ticket Closed'));
});

test('numbers use the separators of the language', () => {
  assert.equal(inEnglish(() => fmtNumber(5860000)), '5,860,000');
  assert.match(inPolish(() => fmtNumber(5860000)), /^5\s860\s000$/);
});

test('translations never invent placeholders', () => {
  const keys = extractKeys();
  const dictionary = loadDictionary();
  const numbered = (text) => new Set([...text.matchAll(/\{(\d+)(?:\|[^{}]*)?\}/g)].map((match) => match[1]));
  const named = (text) => [...new Set([...text.matchAll(/\{([a-zA-Z_.]+)\}/g)].map((match) => match[1]))].sort().join(',');
  const problems = [];
  for (const key of keys.keys()) {
    const translated = dictionary[key];
    if (typeof translated !== 'string') continue;
    const allowed = numbered(key);
    for (const index of numbered(translated)) {
      if (!allowed.has(index)) problems.push(`{${index}} invented: ${key}`);
    }
    if (named(key) !== named(translated)) problems.push(`named placeholders differ: ${key}`);
  }
  assert.deepEqual(problems, []);
});
