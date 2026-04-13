import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDynamicPromptModeInput,
  normalizeDynamicPromptTargetTypeInput,
  validateDynamicPromptRegistryDocument,
} from '../src/ai/dynamic-prompt-validator.js';

test('dynamic prompt validator normalizes records honestly', () => {
  const result = validateDynamicPromptRegistryDocument({
    prompts: [
      {
        id: ' prompt-1 ',
        displayNumber: 1,
        name: '  Overlay  Satu ',
        content: '  Jawab   ringkas. \r\n Tetap natural.  ',
        targetType: 'global',
        targetMembers: [],
        mode: 'dm+group',
        priority: 5,
        trigger: {
          type: 'keyword',
          value: ['  halo ', '  info  '],
        },
        isActive: true,
        createdBy: ' system ',
        createdByNumber: ' 201507007785 ',
        updatedBy: ' system ',
        updatedByNumber: ' 201507007785 ',
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z',
        version: 1,
        lastUpdatedChatJid: '2362534006947@lid',
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.prompts[0]?.id, 'prompt-1');
  assert.equal(result.value.prompts[0]?.displayNumber, 1);
  assert.equal(result.value.prompts[0]?.name, 'Overlay Satu');
  assert.equal(result.value.prompts[0]?.content, 'Jawab   ringkas.\nTetap natural.');
  assert.equal(result.value.prompts[0]?.targetType, 'global');
  assert.deepEqual(result.value.prompts[0]?.targetMembers, []);
  assert.equal(result.value.prompts[0]?.mode, 'dm+group');
  assert.deepEqual(result.value.prompts[0]?.trigger.value, ['halo', 'info']);
  assert.equal(result.value.prompts[0]?.createdByNumber, '201507007785');
});

test('dynamic prompt validator rejects ambiguous duplicates', () => {
  const result = validateDynamicPromptRegistryDocument({
    prompts: [
      buildPrompt({
        id: 'prompt-1',
        displayNumber: 1,
        name: 'Overlay',
      }),
      buildPrompt({
        id: 'prompt-2',
        displayNumber: 2,
        name: 'Overlay',
      }),
    ],
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.match(result.error, /ambiguous and duplicated/i);
});

test('dynamic prompt validator normalizes legacy whatsapp prompt schema honestly', () => {
  const result = validateDynamicPromptRegistryDocument({
    prompts: [
      {
        id: 'legacy-1',
        name: 'Legacy Sender',
        content: 'Jawab ringkas.',
        scope: 'sender',
        target: '628111222333',
        priority: 5,
        trigger: {
          type: 'always',
          value: null,
        },
        isActive: true,
        createdBy: 'system',
        updatedBy: 'system',
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z',
        version: 1,
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.prompts[0]?.targetType, 'specific');
  assert.deepEqual(result.value.prompts[0]?.targetMembers, ['628111222333']);
  assert.equal(result.value.prompts[0]?.mode, 'dm+group');
  assert.equal(result.value.prompts[0]?.displayNumber, 1);
});

test('dynamic prompt validator rejects specific target type without target members', () => {
  const result = validateDynamicPromptRegistryDocument({
    prompts: [
      buildPrompt({
        id: 'prompt-1',
        displayNumber: 1,
        targetType: 'specific',
        targetMembers: [],
      }),
    ],
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.match(result.error, /specific targetMembers must not be empty/i);
});

test('dynamic prompt validator normalizes mode and target type tokens honestly', () => {
  assert.equal(normalizeDynamicPromptTargetTypeInput('Global'), 'global');
  assert.equal(normalizeDynamicPromptTargetTypeInput('spesifik'), 'specific');
  assert.equal(normalizeDynamicPromptModeInput('dm only'), 'dm only');
  assert.equal(normalizeDynamicPromptModeInput('group-only'), 'group only');
  assert.equal(normalizeDynamicPromptModeInput('dm + group'), 'dm+group');
});

function buildPrompt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prompt-1',
    displayNumber: 1,
    name: 'Overlay',
    content: 'Jawab ringkas.',
    targetType: 'global',
    targetMembers: [],
    mode: 'dm+group',
    priority: 5,
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
