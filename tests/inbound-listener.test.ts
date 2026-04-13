import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { WAMessage } from '@whiskeysockets/baileys';

import { loadAppConfig } from '../src/config/app-config.js';
import { createLogger } from '../src/core/logger.js';
import { createRuntimeStateStore } from '../src/runtime/runtime-state-store.js';
import { createInboundMessageListener } from '../src/whatsapp/inbound-listener.js';
import type { RuntimeIdentityResolutionSnapshot } from '../src/whatsapp/types.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('inbound listener records resolved inbound messages into runtime state and log', async () => {
  const temp = await createTempRoot('stage-2-inbound-received-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-2' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const listener = createInboundMessageListener({ logger, runtimeStateStore });
  const resolution = buildResolution({
    chatJid: '201507007785@s.whatsapp.net',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    isFromSelf: false,
    isGroup: false,
    source: 'remote_jid',
  });

  const result = await listener.processMessage(
    {
      key: {
        id: 'msg-1',
        remoteJid: '201507007785@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: 'halo dari nomor lain',
      },
      messageTimestamp: 1_744_252_800,
    } as WAMessage,
    'notify',
    resolution,
  );

  assert.equal(result.kind, 'received');
  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.inboundReady, true);
  assert.equal(snapshot.lastInboundMessageId, 'msg-1');
  assert.equal(snapshot.lastInboundSender, '201507007785@s.whatsapp.net');
  assert.equal(snapshot.lastInboundNormalizedSender, '201507007785');
  assert.equal(snapshot.lastInboundChatJid, '201507007785@s.whatsapp.net');
  assert.equal(snapshot.lastInboundWasFromSelf, false);
  assert.equal(snapshot.lastInboundWasGroup, false);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /inbound\.identity_resolved/);
  assert.match(logContents, /inbound\.received/);
  assert.match(logContents, /halo dari nomor lain/);
});

test('inbound listener ignores non-message payloads without marking inbound ready', async () => {
  const temp = await createTempRoot('stage-2-inbound-ignored-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-2' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const listener = createInboundMessageListener({ logger, runtimeStateStore });

  const result = await listener.processMessage(
    {
      key: {
        id: 'ignored-1',
        remoteJid: '6285655002277@s.whatsapp.net',
        fromMe: true,
      },
      message: {
        protocolMessage: {},
      },
      messageTimestamp: 1_744_252_800,
    } as WAMessage,
    'notify',
    buildResolution({
      chatJid: '6285655002277@s.whatsapp.net',
      senderJid: '6285655002277@s.whatsapp.net',
      normalizedSender: '6285655002277',
      isFromSelf: true,
      isGroup: false,
      source: 'self',
    }),
  );

  assert.equal(result.kind, 'ignored_non_message');
  assert.equal(runtimeStateStore.getSnapshot().inboundReady, false);

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /inbound\.ignored_non_message/);
});

test('inbound listener does not count history append as live inbound proof', async () => {
  const temp = await createTempRoot('stage-2-inbound-history-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-2' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const listener = createInboundMessageListener({ logger, runtimeStateStore });

  const result = await listener.processMessage(
    {
      key: {
        id: 'history-1',
        remoteJid: '201507007785@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: 'pesan lama',
      },
      messageTimestamp: 1_744_252_800,
    } as WAMessage,
    'append',
    buildResolution({
      chatJid: '201507007785@s.whatsapp.net',
      senderJid: '201507007785@s.whatsapp.net',
      normalizedSender: '201507007785',
      isFromSelf: false,
      isGroup: false,
      source: 'remote_jid',
    }),
  );

  assert.equal(result.kind, 'skipped_history');
  assert.equal(runtimeStateStore.getSnapshot().inboundReady, false);
});

function buildResolution(
  overrides: Partial<RuntimeIdentityResolutionSnapshot>,
): RuntimeIdentityResolutionSnapshot {
  return {
    observedAt: '2026-04-10T02:00:00.000Z',
    chatJid: '201507007785@s.whatsapp.net',
    senderJid: '201507007785@s.whatsapp.net',
    normalizedSender: '201507007785',
    senderPn: '201507007785',
    senderLid: null,
    botNumber: '6285655002277',
    botJid: '6285655002277@s.whatsapp.net',
    botLid: null,
    remoteJid: '201507007785@s.whatsapp.net',
    participant: null,
    keyParticipant: null,
    contextParticipant: null,
    explicitSenderPn: null,
    isFromSelf: false,
    isGroup: false,
    source: 'remote_jid',
    ...overrides,
  };
}
