// Loads every module the bot loads at startup and checks the slash-command payloads
// against Discord's limits — without logging in.
import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

async function listJs(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('every source module imports cleanly', async () => {
  const files = (await listJs(srcDir)).filter((file) => path.basename(file) !== 'app.js');
  const failures = [];

  for (const file of files) {
    try {
      await import(pathToFileURL(file).href);
    } catch (error) {
      failures.push(`${path.relative(srcDir, file)}: ${error.message}`);
    }
  }

  assert.deepEqual(failures, []);
});

test('slash commands load and fit Discord limits', async () => {
  const { loadCommands } = await import('../src/handlers/loaders/commandLoader.js');
  const client = {};
  await loadCommands(client);

  assert.ok(client.commands.size > 0, 'no commands loaded');
  assert.ok(client.commands.size <= 100, `Discord allows 100 global commands, got ${client.commands.size}`);

  const problems = [];
  const checkDescription = (where, node) => {
    if (!node.description || node.description.length > 100) {
      problems.push(`${where}: description must be 1-100 chars (${node.description?.length ?? 0})`);
    }
    for (const [locale, text] of Object.entries(node.description_localizations ?? {})) {
      if (!text || text.length > 100) problems.push(`${where}: ${locale} description must be 1-100 chars (${text?.length ?? 0})`);
    }
  };

  const walk = (where, node, depth = 0) => {
    if (!/^[\p{Ll}\p{Lm}\p{Lo}\p{N}_-]{1,32}$/u.test(node.name)) problems.push(`${where}: invalid name "${node.name}"`);
    checkDescription(where, node);
    const options = node.options ?? [];
    if (options.length > 25) problems.push(`${where}: more than 25 options`);
    let seenOptional = false;
    for (const option of options) {
      const isSub = option.type === 1 || option.type === 2;
      if (!isSub) {
        if (option.required && seenOptional) problems.push(`${where}.${option.name}: required option after optional one`);
        if (!option.required) seenOptional = true;
      }
      if ((option.choices?.length ?? 0) > 25) problems.push(`${where}.${option.name}: more than 25 choices`);
      for (const choice of option.choices ?? []) {
        if (!choice.name || choice.name.length > 100) problems.push(`${where}.${option.name}: choice name must be 1-100 chars`);
      }
      walk(`${where}.${option.name}`, option, depth + 1);
    }
  };

  for (const command of client.commands.values()) {
    const json = command.data.toJSON();
    walk(`/${json.name}`, json);
    assert.equal(typeof command.execute, 'function', `/${json.name} has no execute()`);
  }

  assert.deepEqual(problems, []);
});
