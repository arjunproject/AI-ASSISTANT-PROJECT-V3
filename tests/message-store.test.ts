import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeMessageStore } from '../src/whatsapp/message-store.js';

test('runtime message store returns sent message payloads for retry lookups', async () => {
  const store = createRuntimeMessageStore();
  store.remember({
    key: {
      id: 'abc123',
      remoteJid: '6285655002277@s.whatsapp.net',
      fromMe: true,
    },
    message: {
      conversation: 'hello from runtime',
    },
  });

  const payload = await store.getMessage({
    id: 'abc123',
    remoteJid: '6285655002277@s.whatsapp.net',
    fromMe: true,
  });

  assert.deepEqual(payload, {
    conversation: 'hello from runtime',
  });
});

test('runtime message store falls back when participant-specific retry key differs', async () => {
  const store = createRuntimeMessageStore();
  store.remember({
    key: {
      id: 'probe-1',
      remoteJid: '6285655002277@s.whatsapp.net',
      fromMe: true,
    },
    message: {
      conversation: 'probe',
    },
  });

  const payload = await store.getMessage({
    id: 'probe-1',
    remoteJid: '6285655002277@s.whatsapp.net',
    participant: '6285655002277:0@s.whatsapp.net',
    fromMe: true,
  });

  assert.deepEqual(payload, {
    conversation: 'probe',
  });
});
