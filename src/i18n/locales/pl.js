// Polish translations, keyed by the English source text.
// Every pl*.json file in this folder is merged (pl.json, pl.moderation.json, ...).
// Run `npm run i18n` to see which strings still need a translation.
import { readFileSync, readdirSync } from 'node:fs';

const dictionary = {};

try {
  const folder = new URL('./', import.meta.url);
  for (const name of readdirSync(folder).sort()) {
    if (!/^pl(\..+)?\.json$/.test(name)) continue;
    try {
      Object.assign(dictionary, JSON.parse(readFileSync(new URL(name, folder), 'utf8')));
    } catch (error) {
      console.error(`[i18n] Could not load ${name}: ${error.message}`);
    }
  }
} catch (error) {
  console.error(`[i18n] Could not read locale folder: ${error.message}`);
}

export default dictionary;
