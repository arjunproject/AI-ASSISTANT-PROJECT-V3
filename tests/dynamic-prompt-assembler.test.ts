import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleDynamicPromptOverlay } from '../src/ai/dynamic-prompt-assembler.js';
import type { DynamicPromptRecord } from '../src/ai/dynamic-prompt-types.js';

test('dynamic prompt assembler applies active prompts in deterministic order', () => {
  const prompts: DynamicPromptRecord[] = [
    buildPrompt({
      id: 'global-a',
      displayNumber: 1,
      name: 'Global A',
      content: 'Instruksi global.',
      targetType: 'global',
      targetMembers: [],
      mode: 'dm+group',
      priority: 1,
    }),
    buildPrompt({
      id: 'sender-a',
      displayNumber: 2,
      name: 'Sender A',
      content: 'Instruksi sender.',
      targetType: 'specific',
      targetMembers: ['628111222333'],
      mode: 'dm+group',
      priority: 9,
    }),
    buildPrompt({
      id: 'dm-a',
      displayNumber: 3,
      name: 'DM A',
      content: 'Instruksi dm.',
      targetType: 'global',
      targetMembers: [],
      mode: 'dm only',
      priority: 2,
    }),
    buildPrompt({
      id: 'inactive-a',
      displayNumber: 4,
      name: 'Inactive A',
      content: 'Tidak boleh ikut.',
      isActive: false,
    }),
  ];

  const result = assembleDynamicPromptOverlay(prompts, {
    chatJid: 'chat-1',
    senderJid: '628111222333@s.whatsapp.net',
    normalizedSender: '628111222333',
    isGroup: false,
    userText: 'halo',
    manualPromptIds: [],
    intentTags: [],
    domainTag: null,
  });

  assert.deepEqual(
    result.appliedPrompts.map((prompt) => prompt.id),
    ['sender-a', 'dm-a', 'global-a'],
  );
  assert.match(result.overlayText ?? '', /\[Sender A\]/);
  assert.doesNotMatch(result.overlayText ?? '', /Inactive A/);
});

test('dynamic prompt assembler matches official group and sender inside official group deterministically', () => {
  const prompts: DynamicPromptRecord[] = [
    buildPrompt({
      id: 'group-a',
      displayNumber: 1,
      name: 'Group A',
      content: 'Khusus grup resmi.',
      targetType: 'global',
      targetMembers: [],
      mode: 'group only',
      priority: 2,
    }),
    buildPrompt({
      id: 'group-sender-a',
      displayNumber: 2,
      name: 'Group Sender A',
      content: 'Khusus sender di grup resmi.',
      targetType: 'specific',
      targetMembers: ['628111222333'],
      mode: 'group only',
      priority: 9,
    }),
  ];

  const result = assembleDynamicPromptOverlay(prompts, {
    chatJid: '120363408735885184@g.us',
    senderJid: '628111222333@s.whatsapp.net',
    normalizedSender: '628111222333',
    isGroup: true,
    userText: 'halo',
    manualPromptIds: [],
    intentTags: [],
    domainTag: null,
  });

  assert.deepEqual(
    result.appliedPrompts.map((prompt) => prompt.id),
    ['group-sender-a', 'group-a'],
  );
});

function buildPrompt(overrides: Partial<DynamicPromptRecord>): DynamicPromptRecord {
  return {
    id: 'prompt-1',
    displayNumber: 1,
    name: 'Overlay',
    content: 'Jawab ringkas.',
    targetType: 'global',
    targetMembers: [],
    mode: 'dm+group',
    priority: 1,
    trigger: {
      type: 'always',
      value: null,
    },
    isActive: true,
    createdBy: 'system',
    createdByNumber: '201507007785',
    updatedBy: 'system',
    updatedByNumber: '201507007785',
    createdAt: '2026-04-11T00:00:00.000Z',
    updatedAt: '2026-04-11T00:00:00.000Z',
    version: 1,
    lastUpdatedChatJid: '2362534006947@lid',
    ...overrides,
  };
}
