import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSystemBotRoutingSkipReason,
  isSiblingBotSender,
  listSiblingBotNumbers,
} from '../src/whatsapp/system-bot-guard.js';

test('system bot guard resolves sibling bot numbers from the paired bot deployment', () => {
  assert.deepEqual(
    listSiblingBotNumbers('6285655002277', ['6285655002277', '201507007785']),
    ['201507007785'],
  );
  assert.deepEqual(
    listSiblingBotNumbers('201507007785', ['6285655002277', '201507007785']),
    ['6285655002277'],
  );
});

test('system bot guard only flags the sibling bot sender and not the runtime owner', () => {
  assert.equal(
    isSiblingBotSender('201507007785', '6285655002277', ['6285655002277', '201507007785']),
    true,
  );
  assert.equal(
    isSiblingBotSender('6285655002277', '6285655002277', ['6285655002277', '201507007785']),
    false,
  );
  assert.equal(
    isSiblingBotSender('6281234567890', '6285655002277', ['6285655002277', '201507007785']),
    false,
  );
});

test('system bot routing lets the receiving bot answer a manual sibling DM', () => {
  assert.equal(
    getSystemBotRoutingSkipReason({
      message: {
        key: {
          fromMe: false,
        },
        message: {
          conversation: 'Halo',
        },
      },
      normalizedSender: '6285655002277',
      botPrimaryNumber: '201507007785',
      superAdminNumbers: ['6285655002277', '201507007785'],
      runtimeProfile: 'secondary',
      isFromSelf: false,
      isGroup: false,
      chatJid: '201507007785@s.whatsapp.net',
      botJid: '201507007785@s.whatsapp.net',
      botLid: '2362534006947@lid',
    }),
    null,
  );
});

test('system bot routing skips own outgoing DM to an external bot chat', () => {
  assert.equal(
    getSystemBotRoutingSkipReason({
      message: {
        key: {
          fromMe: true,
          remoteJid: '2362534006947@lid',
        },
        message: {
          conversation: 'Halo',
        },
      },
      normalizedSender: '6285655002277',
      botPrimaryNumber: '6285655002277',
      superAdminNumbers: ['6285655002277', '201507007785'],
      runtimeProfile: 'primary',
      isFromSelf: true,
      isGroup: false,
      chatJid: '2362534006947@lid',
      botJid: '6285655002277@s.whatsapp.net',
      botLid: '18687553736945@lid',
    }),
    'own_external_message',
  );
});

test('system bot routing still allows self-chat messages from the runtime owner', () => {
  assert.equal(
    getSystemBotRoutingSkipReason({
      message: {
        key: {
          fromMe: true,
          remoteJid: '18687553736945@lid',
        },
        message: {
          conversation: 'Halo diri sendiri',
        },
      },
      normalizedSender: '6285655002277',
      botPrimaryNumber: '6285655002277',
      superAdminNumbers: ['6285655002277', '201507007785'],
      runtimeProfile: 'primary',
      isFromSelf: true,
      isGroup: false,
      chatJid: '18687553736945@lid',
      botJid: '6285655002277@s.whatsapp.net',
      botLid: '18687553736945@lid',
    }),
    null,
  );
});

test('system bot routing skips quoted automatic replies from the sibling bot', () => {
  assert.equal(
    getSystemBotRoutingSkipReason({
      message: {
        key: {
          fromMe: false,
        },
        message: {
          extendedTextMessage: {
            text: 'Halo juga',
            contextInfo: {
              stanzaId: 'manual-message-from-this-bot',
              quotedMessage: {
                conversation: 'Halo',
              },
            },
          },
        },
      },
      normalizedSender: '201507007785',
      botPrimaryNumber: '6285655002277',
      superAdminNumbers: ['6285655002277', '201507007785'],
      runtimeProfile: 'primary',
      isFromSelf: false,
      isGroup: false,
      chatJid: '2362534006947@lid',
      botJid: '6285655002277@s.whatsapp.net',
      botLid: '18687553736945@lid',
    }),
    'sibling_bot_auto_reply',
  );
});

test('system bot routing disables group replies on the secondary bot only', () => {
  const common = {
    message: {
      key: {
        fromMe: false,
        remoteJid: '120363408735885184@g.us',
      },
      message: {
        conversation: 'Halo grup',
      },
    },
    normalizedSender: '6285655002277',
    botPrimaryNumber: '201507007785',
    superAdminNumbers: ['6285655002277', '201507007785'],
    isFromSelf: false,
    isGroup: true,
    chatJid: '120363408735885184@g.us',
    botJid: '201507007785@s.whatsapp.net',
    botLid: '2362534006947@lid',
  } as const;

  assert.equal(
    getSystemBotRoutingSkipReason({
      ...common,
      runtimeProfile: 'secondary',
    }),
    'secondary_group_runtime',
  );
  assert.equal(
    getSystemBotRoutingSkipReason({
      ...common,
      runtimeProfile: 'primary',
      botPrimaryNumber: '6285655002277',
      botJid: '6285655002277@s.whatsapp.net',
      botLid: '18687553736945@lid',
    }),
    null,
  );
});
