import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAdminDisplayName } from '../src/command/admin-name-normalizer.js';

test('admin name normalizer trims, collapses spaces, and compares case-insensitively', () => {
  assert.deepEqual(normalizeAdminDisplayName('  Rahma  '), {
    ok: true,
    displayName: 'Rahma',
    nameKey: 'rahma',
    reason: null,
  });
  assert.deepEqual(normalizeAdminDisplayName('rahmA'), {
    ok: true,
    displayName: 'rahmA',
    nameKey: 'rahma',
    reason: null,
  });
});

test('admin name normalizer keeps different spellings distinct and rejects invalid names', () => {
  const rahma = normalizeAdminDisplayName('Rahma');
  const rahmah = normalizeAdminDisplayName('Rahmah');
  assert.equal(rahma.ok, true);
  assert.equal(rahmah.ok, true);
  if (rahma.ok && rahmah.ok) {
    assert.notEqual(rahma.nameKey, rahmah.nameKey);
  }

  assert.deepEqual(normalizeAdminDisplayName(''), {
    ok: false,
    displayName: null,
    nameKey: null,
    reason: 'missing_name',
  });
  assert.deepEqual(normalizeAdminDisplayName('12345'), {
    ok: false,
    displayName: null,
    nameKey: null,
    reason: 'invalid_name',
  });
});
