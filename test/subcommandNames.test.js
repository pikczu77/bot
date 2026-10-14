import test from 'node:test';
import assert from 'node:assert/strict';
import { mapArgumentsToOptions } from '../src/utils/prefixParser.js';

const bank = {
  name: 'bank',
  options: [
    { type: 1, name: 'wplac', options: [{ type: 3, name: 'amount' }] },
    { type: 1, name: 'wyplac', options: [{ type: 3, name: 'amount' }] },
  ],
};
const music = {
  name: 'music',
  options: [{ type: 1, name: 'remove', options: [{ type: 4, name: 'position' }] }],
};

test('prefix commands accept old English subcommand names after the Polish rename', () => {
  assert.equal(mapArgumentsToOptions(['wplac', '50'], bank).getSubcommand(), 'wplac');
  assert.equal(mapArgumentsToOptions(['deposit', '50'], bank).getSubcommand(), 'wplac');
  // A subcommand that kept its English name is found as it is.
  assert.equal(mapArgumentsToOptions(['remove', '2'], music).getSubcommand(), 'remove');
});
