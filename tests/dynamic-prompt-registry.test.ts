import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createDynamicPromptRegistry, writeDynamicPromptRegistry } from '../src/ai/dynamic-prompt-registry.js';
import type { DynamicPromptRecord } from '../src/ai/dynamic-prompt-types.js';
import { createLogger } from '../src/core/logger.js';
import { createTempRoot } from './test-helpers.js';

test('dynamic prompt registry creates official files and stays ready when empty', async () => {
  const temp = await createTempRoot('stage-5-dynamic-prompt-registry-empty-');
  const registryFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompts.json');
  const auditFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompt-audit.json');
  const logger = createLogger(join(temp.root, '.runtime', 'logs', 'runtime.log'));

  try {
    const registry = createDynamicPromptRegistry({
      registryFilePath,
      auditFilePath,
      logger,
    });

    const inspection = await registry.inspect();

    assert.equal(inspection.ready, true);
    assert.equal(inspection.activeCount, 0);
    assert.equal(inspection.error, null);

    const registryDocument = JSON.parse(await readFile(registryFilePath, 'utf8')) as { prompts?: unknown[] };
    const auditDocument = JSON.parse(await readFile(auditFilePath, 'utf8')) as { entries?: unknown[] };
    assert.deepEqual(registryDocument.prompts, []);
    assert.deepEqual(auditDocument.entries, []);
  } finally {
    await temp.cleanup();
  }
});

test('dynamic prompt registry records audit entries for live registry changes', async () => {
  const temp = await createTempRoot('stage-5-dynamic-prompt-registry-audit-');
  const registryFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompts.json');
  const auditFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompt-audit.json');
  const logger = createLogger(join(temp.root, '.runtime', 'logs', 'runtime.log'));

  try {
    await writeDynamicPromptRegistry(registryFilePath, [
      buildPrompt({
        id: 'prompt-1',
        displayNumber: 1,
      }),
    ]);

    const registry = createDynamicPromptRegistry({
      registryFilePath,
      auditFilePath,
      logger,
    });
    const inspection = await registry.inspect();

    assert.equal(inspection.ready, true);
    assert.equal(inspection.activeCount, 1);
    assert.equal(inspection.lastAuditAt !== null, true);

    const auditDocument = JSON.parse(await readFile(auditFilePath, 'utf8')) as {
      entries: Array<{ action: string; promptId: string; displayNumber: number; targetSnapshot: { targetType: string } }>;
    };
    assert.equal(auditDocument.entries.length, 1);
    assert.equal(auditDocument.entries[0]?.action, 'created');
    assert.equal(auditDocument.entries[0]?.promptId, 'prompt-1');
    assert.equal(auditDocument.entries[0]?.displayNumber, 1);
    assert.equal(auditDocument.entries[0]?.targetSnapshot.targetType, 'global');
  } finally {
    await temp.cleanup();
  }
});

test('dynamic prompt registry records retargeted action when target or mode changes', async () => {
  const temp = await createTempRoot('stage-5-dynamic-prompt-registry-retarget-');
  const registryFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompts.json');
  const auditFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompt-audit.json');
  const logger = createLogger(join(temp.root, '.runtime', 'logs', 'runtime.log'));

  try {
    await writeDynamicPromptRegistry(registryFilePath, [
      buildPrompt({
        id: 'prompt-1',
        displayNumber: 1,
      }),
    ]);

    const registry = createDynamicPromptRegistry({
      registryFilePath,
      auditFilePath,
      logger,
    });
    await registry.inspect();

    await writeDynamicPromptRegistry(registryFilePath, [
      buildPrompt({
        id: 'prompt-1',
        displayNumber: 1,
        targetType: 'specific',
        targetMembers: ['628111222333'],
        mode: 'group only',
        updatedBy: 'operator',
        updatedByNumber: '628111222333',
        updatedAt: '2026-04-11T00:05:00.000Z',
        version: 2,
      }),
    ]);

    await registry.inspect();

    const auditDocument = JSON.parse(await readFile(auditFilePath, 'utf8')) as {
      entries: Array<{ action: string; promptId: string; targetSnapshot: { targetMembers: string[] }; modeSnapshot: string }>;
    };
    const lastEntry = auditDocument.entries.at(-1);
    assert.equal(lastEntry?.action, 'retargeted');
    assert.equal(lastEntry?.promptId, 'prompt-1');
    assert.deepEqual(lastEntry?.targetSnapshot.targetMembers, ['628111222333']);
    assert.equal(lastEntry?.modeSnapshot, 'group only');
  } finally {
    await temp.cleanup();
  }
});

test('dynamic prompt registry fails closed when audit log is broken', async () => {
  const temp = await createTempRoot('stage-5-dynamic-prompt-registry-broken-audit-');
  const registryFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompts.json');
  const auditFilePath = join(temp.root, '.runtime', 'ai', 'dynamic-prompt-audit.json');
  const logger = createLogger(join(temp.root, '.runtime', 'logs', 'runtime.log'));

  try {
    await writeDynamicPromptRegistry(registryFilePath, [buildPrompt()]);
    await writeFile(auditFilePath, '{ broken-json', 'utf8');

    const registry = createDynamicPromptRegistry({
      registryFilePath,
      auditFilePath,
      logger,
    });
    const inspection = await registry.inspect();

    assert.equal(inspection.ready, false);
    assert.match(inspection.error ?? '', /Unexpected token|Expected property name|JSON/i);
  } finally {
    await temp.cleanup();
  }
});

function buildPrompt(overrides: Partial<DynamicPromptRecord> = {}): DynamicPromptRecord {
  return {
    id: 'prompt-1',
    displayNumber: 1,
    name: 'Overlay',
    content: 'Jawab ringkas.',
    targetType: 'global',
    targetMembers: [],
    mode: 'dm+group',
    priority: 1,
    trigger: { type: 'always', value: null },
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
