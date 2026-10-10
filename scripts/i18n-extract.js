// i18n-extract.js — list every translatable string in src/ and report what is
// missing from the Polish dictionary.
//
//   node scripts/i18n-extract.js            summary + missing keys
//   node scripts/i18n-extract.js --json     machine-readable { key: [files] }
//   node scripts/i18n-extract.js --check    exit 1 when translations are missing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const localesDir = path.join(srcDir, 'i18n', 'locales');

function listJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function templateKey(quasi) {
  let key = '';
  quasi.quasis.forEach((part, index) => {
    key += part.value.cooked ?? part.value.raw;
    if (index < quasi.expressions.length) key += `{${index}}`;
  });
  return key;
}

function literalKey(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return templateKey(node);
  return null;
}

export function extractKeys() {
  const keys = new Map();
  const add = (key, file) => {
    if (!key || !/\p{L}/u.test(key)) return;
    if (!keys.has(key)) keys.set(key, new Set());
    keys.get(key).add(file);
  };

  for (const file of listJs(srcDir)) {
    if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
    const code = fs.readFileSync(file, 'utf8');
    const rel = path.relative(srcDir, file).replace(/\\/g, '/');
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });

    walk.simple(ast, {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return;
        const name = node.callee.name;
        if (name === 't' || name === 'N_' || name === 'trAny') add(literalKey(node.arguments[0]), rel);
        if (name === 'sameText' || name === 'tl') add(literalKey(node.arguments[1]), rel);
      },
      TaggedTemplateExpression(node) {
        if (node.tag.type === 'Identifier' && node.tag.name === 't') add(templateKey(node.quasi), rel);
      },
    });
  }

  return keys;
}

export function loadDictionary() {
  const dictionary = {};
  if (!fs.existsSync(localesDir)) return dictionary;
  for (const name of fs.readdirSync(localesDir)) {
    if (/^pl(\..+)?\.json$/.test(name)) {
      Object.assign(dictionary, JSON.parse(fs.readFileSync(path.join(localesDir, name), 'utf8')));
    }
  }
  return dictionary;
}

function placeholders(text) {
  return [...new Set([...text.matchAll(/\{(\d+)(?:\|[^{}]*)?\}/g)].map((match) => match[1]))].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = extractKeys();
  const dictionary = loadDictionary();

  if (process.argv.includes('--json')) {
    const out = {};
    for (const [key, files] of keys) out[key] = [...files];
    process.stdout.write(JSON.stringify(out, null, 1));
  } else {
    const missing = [...keys.keys()].filter((key) => typeof dictionary[key] !== 'string');
    const unused = Object.keys(dictionary).filter((key) => !keys.has(key));
    const broken = [...keys.keys()].filter((key) => {
      const translated = dictionary[key];
      if (typeof translated !== 'string') return false;
      const want = placeholders(key);
      const have = placeholders(translated);
      // A translation may drop a placeholder (plural helpers) but never invent one.
      return have.some((index) => !want.includes(index));
    });

    console.log(`keys: ${keys.size}  translated: ${keys.size - missing.length}  missing: ${missing.length}  unused: ${unused.length}  bad placeholders: ${broken.length}`);
    if (process.argv.includes('--list')) {
      for (const key of missing) console.log(`MISSING ${JSON.stringify(key)}`);
    }
    for (const key of broken) console.log(`BAD PLACEHOLDER ${JSON.stringify(key)} -> ${JSON.stringify(dictionary[key])}`);
    if (process.argv.includes('--check') && (missing.length > 0 || broken.length > 0)) process.exit(1);
  }
}
