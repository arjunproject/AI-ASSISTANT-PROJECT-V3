import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadAppConfig } from '../src/config/app-config.js';
import { createLogger } from '../src/core/logger.js';
import {
  enqueueRuntimeTestMessage,
  resolveRuntimeTestTargetJid,
  startRuntimeTestOutbox,
  type RuntimeTestOutboxRequest,
} from '../src/runtime/runtime-test-outbox.js';
import { createTempRoot, waitFor } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('runtime test outbox queues bot2 messages only for bot1 target', async () => {
  const temp = await createTempRoot('runtime-test-outbox-queue-');
  cleanups.push(temp.cleanup);
  const config = loadBot2TestConfig(temp.root);

  const result = await enqueueRuntimeTestMessage(config, {
    target: 'bot1',
    text: 'halo dari bot2 tester',
  });

  assert.equal(result.targetJid, '6285655002277@s.whatsapp.net');
  await access(result.filePath);
  assert.equal(resolveRuntimeTestTargetJid(config, 'bot1'), result.targetJid);

  await assert.rejects(
    () => enqueueRuntimeTestMessage(config, { target: 'admin', text: 'tidak boleh' }),
    /Only target "bot1"/,
  );
});

test('runtime test outbox sends queued bot2 message through the active runtime callback', async () => {
  const temp = await createTempRoot('runtime-test-outbox-send-');
  cleanups.push(temp.cleanup);
  const config = loadBot2TestConfig(temp.root);
  const logger = createLogger(join(temp.root, '.runtime-bot2', 'logs', 'runtime.log'));
  const sentRequests: RuntimeTestOutboxRequest[] = [];

  const controller = startRuntimeTestOutbox({
    config,
    logger,
    async sendText(_targetJid, _text, request) {
      sentRequests.push(request);
      return {
        messageId: 'fake-message-id',
      };
    },
  });

  try {
    await enqueueRuntimeTestMessage(config, {
      target: 'bot1',
      text: 'tes memory konteks 001',
    });

    await waitFor(async () => sentRequests.length === 1);

    const sentFiles = await readdir(join(config.runtimeRoot, 'test-outbox', 'sent'));
    assert.equal(sentFiles.length, 1);
    const sentRecord = JSON.parse(
      await readFile(join(config.runtimeRoot, 'test-outbox', 'sent', sentFiles[0]!), 'utf8'),
    ) as Record<string, unknown>;

    assert.equal(sentRecord.status, 'sent');
    assert.equal(sentRecord.messageId, 'fake-message-id');
    assert.equal(sentRecord.targetJid, '6285655002277@s.whatsapp.net');
    assert.equal(sentRecord.text, 'tes memory konteks 001');
  } finally {
    await controller.stop();
  }
});

function loadBot2TestConfig(projectRoot: string) {
  return loadAppConfig({
    projectRoot,
    runtimeProfile: 'secondary',
    botPrimaryNumber: '201507007785',
    superAdminNumbers: ['6285655002277', '201507007785'],
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
}
