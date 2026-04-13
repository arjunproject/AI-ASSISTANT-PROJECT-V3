import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WAMessage } from '@whiskeysockets/baileys';

import { resolveSenderIdentity } from '../src/whatsapp/identity-resolver.js';

test('identity resolver keeps direct sender separate from bot identity in direct chats', () => {
  const result = resolveSenderIdentity(
    {
      key: {
        id: 'direct-1',
        remoteJid: '201507007785@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: 'halo',
      },
    } as WAMessage,
    {
      selfJid: '6285655002277:83@s.whatsapp.net',
      selfLid: '18687553736945:83@lid',
      botPrimaryNumber: '6285655002277',
      lidToPn: new Map(),
      pnToLid: new Map([
        ['6285655002277', '18687553736945'],
      ]),
    },
  );

  assert.ok(result);
  assert.equal(result.chatJid, '201507007785@s.whatsapp.net');
  assert.equal(result.senderJid, '201507007785@s.whatsapp.net');
  assert.equal(result.normalizedSender, '201507007785');
  assert.equal(result.botNumber, '6285655002277');
  assert.equal(result.botJid, '6285655002277@s.whatsapp.net');
  assert.equal(result.botLid, '18687553736945@lid');
  assert.equal(result.isFromSelf, false);
  assert.equal(result.isGroup, false);
  assert.equal(result.source, 'remote_jid');
});

test('identity resolver prefers group participant over remoteJid', () => {
  const result = resolveSenderIdentity(
    {
      key: {
        id: 'group-1',
        remoteJid: '120363025271234567@g.us',
        participant: '201507007785@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: 'grup',
      },
      participant: '201507007785@s.whatsapp.net',
    } as WAMessage,
    {
      selfJid: '6285655002277:83@s.whatsapp.net',
      selfLid: null,
      botPrimaryNumber: '6285655002277',
      lidToPn: new Map(),
      pnToLid: new Map(),
    },
  );

  assert.ok(result);
  assert.equal(result.chatJid, '120363025271234567@g.us');
  assert.equal(result.senderJid, '201507007785@s.whatsapp.net');
  assert.equal(result.normalizedSender, '201507007785');
  assert.equal(result.isGroup, true);
  assert.equal(result.source, 'participant');
});

test('identity resolver normalizes @lid sender using stored mappings', () => {
  const result = resolveSenderIdentity(
    {
      key: {
        id: 'group-lid-1',
        remoteJid: '120363025271234567@g.us',
        participant: '259308784762908:12@lid',
        fromMe: false,
      },
      message: {
        conversation: 'halo lid',
      },
      participant: '259308784762908:12@lid',
    } as WAMessage,
    {
      selfJid: '6285655002277:83@s.whatsapp.net',
      selfLid: null,
      botPrimaryNumber: '6285655002277',
      lidToPn: new Map([
        ['259308784762908', '201507007785'],
      ]),
      pnToLid: new Map([
        ['201507007785', '259308784762908'],
      ]),
    },
  );

  assert.ok(result);
  assert.equal(result.chatJid, '120363025271234567@g.us');
  assert.equal(result.senderJid, '259308784762908@lid');
  assert.equal(result.senderLid, '259308784762908@lid');
  assert.equal(result.normalizedSender, '201507007785');
  assert.equal(result.isFromSelf, false);
  assert.equal(result.source, 'participant');
});
