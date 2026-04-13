import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCommandTargetNumber } from '../src/command/number-normalizer.js';

test('number normalizer strips symbols, spaces, plus sign, and jid suffix into one canonical number', () => {
  assert.deepEqual(normalizeCommandTargetNumber('+62 812-1737-5459@s.whatsapp.net'), {
    ok: true,
    normalized: '6281217375459',
    reason: null,
  });
  assert.deepEqual(normalizeCommandTargetNumber('+201 507 007 785'), {
    ok: true,
    normalized: '201507007785',
    reason: null,
  });
});

test('number normalizer rejects missing and invalid targets honestly', () => {
  assert.deepEqual(normalizeCommandTargetNumber(''), {
    ok: false,
    normalized: null,
    reason: 'missing_number',
  });
  assert.deepEqual(normalizeCommandTargetNumber('0812-1234'), {
    ok: false,
    normalized: null,
    reason: 'invalid_number',
  });
  assert.deepEqual(normalizeCommandTargetNumber('18687553736945@lid'), {
    ok: false,
    normalized: null,
    reason: 'invalid_number',
  });
});
