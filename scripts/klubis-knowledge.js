// Makes src/config/klubisKnowledgeData.js from the site's data, so Klubiś knows Club SMP's items and recipes and Pikczu's videos.
// The bot's host does not have the site's folder, so the result is committed. Run again when the site's data changes:
//   node scripts/klubis-knowledge.js ../../pikczu/tools/pikczu-pl

import fs from 'node:fs';
import path from 'node:path';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node scripts/klubis-knowledge.js <folder with itemy.json, craftingi.json, filmy.json>');
  process.exit(1);
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const MAX_ANSWER = 700;
const cut = (text) => (text.length > MAX_ANSWER ? `${text.slice(0, MAX_ANSWER).trimEnd()}...` : text);

const items = [];
const groups = [];
for (const group of read('itemy.json').grupy) {
  if (group.opis) groups.push({ name: group.tytul, text: `**${group.tytul}**: ${group.opis}` });
  for (const item of group.przedmioty ?? []) {
    const about = [item.rzadkosc, ...(item.tagi ?? [])].filter(Boolean).join(', ');
    const body = [item.opis, ...(item.lista ?? [])].filter(Boolean).join(' • ');
    items.push({ name: item.nazwa, text: cut(`**${item.nazwa}**${about ? ` (${about})` : ''}: ${body || group.opis || group.tytul}`) });
  }
}

const crafting = read('craftingi.json');
const nameOf = (key) => crafting.przedmioty[key]?.nazwa ?? key;
const recipes = [];
for (const group of crafting.grupy) {
  for (const recipe of group.przepisy) {
    const parts = recipe.kowalski ?? recipe.siatka ?? [];
    const counts = new Map();
    for (const key of parts.filter(Boolean)) counts.set(key, (counts.get(key) ?? 0) + 1);
    const list = [...counts].map(([key, count]) => `${count > 1 ? `${count} x ` : ''}${nameOf(key)}`).join(', ');
    const place = recipe.kowalski ? 'stół kowalski' : recipe.dowolnie ? 'w dowolnym układzie' : '';
    const made = recipe.ilosc > 1 ? ` (wychodzi ${recipe.ilosc})` : '';
    recipes.push({ name: nameOf(recipe.wynik), text: cut(`**${nameOf(recipe.wynik)}**${made}: ${list}${place ? `, ${place}` : ''}.${recipe.uwaga ? ` ${recipe.uwaga}` : ''}`) });
  }
}

const films = read('filmy.json');
const list = [...films.filmy].filter((film) => film.czas >= 60);
const pick = (film) => ({ title: film.tytul, id: film.id, views: film.wyswietlenia, at: film.ts });
const data = {
  subscribers: films.kanal.subskrybenci,
  shorts: films.kanal.shorty,
  videosAt: films.pobrano,
  latest: list.map(pick).sort((a, b) => b.at - a.at).slice(0, 3),
  mostViewed: list.map(pick).sort((a, b) => b.views - a.views).slice(0, 3),
};

const out = `// Made by scripts/klubis-knowledge.js from the site's data (itemy.json, craftingi.json, filmy.json). Do not edit by hand.
export const SMP_ITEMS = ${JSON.stringify(items, null, 0)};
export const SMP_GROUPS = ${JSON.stringify(groups, null, 0)};
export const SMP_RECIPES = ${JSON.stringify(recipes, null, 0)};
export const VIDEOS = ${JSON.stringify(data, null, 0)};
`;
fs.writeFileSync(new URL('../src/config/klubisKnowledgeData.js', import.meta.url), out);
console.log(`${items.length} items, ${groups.length} groups, ${recipes.length} recipes, ${data.latest.length} latest videos`);
