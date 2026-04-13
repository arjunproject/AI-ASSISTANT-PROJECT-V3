import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WAMessage } from '@whiskeysockets/baileys';

import {
  parseAdminCommandMessage,
  parseOfficialCommandMessage,
  parsePromptCommandMessage,
  parseSuperAdminCommandMessage,
} from '../src/command/command-parser.js';

test('command parser normalizes slash, case, spacing, and separators into one canonical command', () => {
  const variants = [
    'Admin list',
    'admin list',
    '/admin list',
    'ADMIN   LIST',
    'admin-list',
    'admin_list',
  ];

  for (const variant of variants) {
    const parsed = parseAdminCommandMessage(buildMessage(variant));
    assert.equal(parsed.kind, 'command');
    if (parsed.kind === 'command') {
      assert.equal(parsed.parsed.definition.name, 'admin.list');
      assert.equal(parsed.parsed.definition.canonical, 'admin list');
    }
  }
});

test('command parser preserves normalized target argument after global normalization', () => {
  const parsed = parseAdminCommandMessage(buildMessage('/ADMIN-STATUS +62 812-1737-5459@s.whatsapp.net'));

  assert.equal(parsed.kind, 'command');
  if (parsed.kind === 'command') {
    assert.equal(parsed.parsed.definition.name, 'admin.status');
    assert.equal(parsed.parsed.argsText, '+62 812 1737 5459@s.whatsapp.net');
    assert.equal(parsed.parsed.rawArgsText, '+62 812 1737 5459@s.whatsapp.net');
  }
});

test('command parser supports natural postfix target form for admin target commands', () => {
  const parsed = parseAdminCommandMessage(buildMessage('ADMIN Rahma OFF'));

  assert.equal(parsed.kind, 'command');
  if (parsed.kind === 'command') {
    assert.equal(parsed.parsed.definition.name, 'admin.off');
    assert.equal(parsed.parsed.argsText, 'rahma');
    assert.equal(parsed.parsed.rawArgsText, 'Rahma');
  }
});

test('command parser ignores ordinary non-command text', () => {
  const parsed = parseAdminCommandMessage(buildMessage('halo biasa'));

  assert.equal(parsed.kind, 'not_command');
});

test('command parser does not treat image captions as admin commands', () => {
  const parsed = parseOfficialCommandMessage({
    key: {
      id: 'cmd-image-1',
      remoteJid: '201507007785@s.whatsapp.net',
      fromMe: false,
    },
    message: {
      imageMessage: {
        caption: 'Admin help',
        mimetype: 'image/jpeg',
      },
    },
  } as WAMessage);

  assert.equal(parsed.kind, 'not_command');
});

test('command parser rejects incomplete or unknown admin commands honestly', () => {
  assert.equal(parseAdminCommandMessage(buildMessage('admin')).kind, 'invalid_command');
  assert.equal(parseAdminCommandMessage(buildMessage('/admin unknown 6281')).kind, 'invalid_command');
});

test('command parser recognizes prompt commands through official parser', () => {
  const parsed = parseOfficialCommandMessage(buildMessage('Prompt list'));

  assert.equal(parsed.kind, 'command');
  if (parsed.kind === 'command') {
    assert.equal(parsed.parsed.definition.name, 'prompt.list');
    assert.equal(parsed.parsed.definition.canonical, 'prompt list');
  }
});

test('command parser recognizes superadmin commands through official parser', () => {
  const parsed = parseOfficialCommandMessage(buildMessage('SuperAdmin off 201507007785'));

  assert.equal(parsed.kind, 'command');
  if (parsed.kind === 'command') {
    assert.equal(parsed.parsed.definition.name, 'superadmin.off');
    assert.equal(parsed.parsed.definition.canonical, 'superadmin off');
    assert.equal(parsed.parsed.rawArgsText, '201507007785');
  }
});

test('command parser recognizes direct superadmin parser path honestly', () => {
  const parsed = parseSuperAdminCommandMessage(buildMessage('superadmin list'));

  assert.equal(parsed.kind, 'command');
  if (parsed.kind === 'command') {
    assert.equal(parsed.parsed.definition.name, 'superadmin.list');
  }
});

test('command parser keeps prompt numbering arguments intact for prompt edit commands', () => {
  const parsed = parsePromptCommandMessage(buildMessage('Prompt edit 12'));

  assert.equal(parsed.kind, 'command');
  if (parsed.kind === 'command') {
    assert.equal(parsed.parsed.definition.name, 'prompt.edit');
    assert.equal(parsed.parsed.rawArgsText, '12');
  }
});

function buildMessage(text: string): WAMessage {
  return {
    key: {
      id: 'cmd-1',
      remoteJid: '201507007785@s.whatsapp.net',
      fromMe: false,
    },
    message: {
      conversation: text,
    },
  } as WAMessage;
}
