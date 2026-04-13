import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { loadAppConfig } from '../src/config/app-config.js';
import { createLogger } from '../src/core/logger.js';
import { createQrManager } from '../src/whatsapp/qr-manager.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('qr manager writes PNG file and calls Paint opener dependency', async () => {
  const temp = await createTempRoot('stage-1-qr-manager-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-1',
  });
  const logger = createLogger(config.logFilePath);
  let openedPath: string | null = null;

  const qrManager = createQrManager(config, logger, {
    async openQrInPaint(filePath) {
      openedPath = filePath;
      return {
        opened: true,
        paintPid: 4242,
      };
    },
  });

  const result = await qrManager.generate('hello-stage-1');
  const contents = await readFile(config.whatsappQrFilePath);

  assert.equal(result.opened, true);
  assert.equal(result.paintPid, 4242);
  assert.equal(openedPath, config.whatsappQrFilePath);
  assert.equal(contents.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  await qrManager.clear();
});
