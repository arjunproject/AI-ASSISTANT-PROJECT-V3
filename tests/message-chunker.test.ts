import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitOutgoingText } from '../src/whatsapp/message-chunker.js';

test('message chunker keeps short replies intact', () => {
  const chunks = splitOutgoingText('Halo, ini balasan singkat.');

  assert.deepEqual(chunks, ['Halo, ini balasan singkat.']);
});

test('message chunker splits long multi-record replies on blank-line boundaries', () => {
  const blocks = Array.from({ length: 5 }, (_, index) =>
    [
      `NO: ${index + 1}`,
      `NAMA MOTOR: Motor ${index + 1}`,
      'TAHUN: 2020',
      'PLAT: S 1234 AA',
      'STATUS: READY',
    ].join('\n'),
  );
  const text = blocks.join('\n\n');

  const chunks = splitOutgoingText(text, 120);

  assert.equal(chunks.length > 1, true);
  for (const chunk of chunks) {
    assert.equal(chunk.length <= 120, true);
    assert.doesNotMatch(chunk, /NO:\s\d+\nNAMA MOTOR:[\s\S]*STATUS:\sREADY[\s\S]*NO:\s\d+\nNAMA MOTOR:/u);
  }
  assert.equal(chunks.join('\n\n').includes('NO: 5'), true);
});

test('message chunker falls back to line boundaries before hard cuts', () => {
  const text = [
    'Item 1 - keterangan yang cukup panjang untuk memenuhi satu chunk sendiri.',
    'Item 2 - keterangan yang cukup panjang untuk memenuhi satu chunk sendiri.',
    'Item 3 - keterangan yang cukup panjang untuk memenuhi satu chunk sendiri.',
  ].join('\n');

  const chunks = splitOutgoingText(text, 90);

  assert.equal(chunks.length > 1, true);
  for (const chunk of chunks) {
    assert.equal(chunk.length <= 90, true);
    assert.doesNotMatch(chunk, /sendiri\.\nItem \d -[\s\S]*sendiri\.\nItem \d -/u);
  }
});

test('message chunker hard-splits only when a single token exceeds the limit', () => {
  const giantToken = 'X'.repeat(150);
  const chunks = splitOutgoingText(giantToken, 60);

  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [60, 60, 30]);
});
