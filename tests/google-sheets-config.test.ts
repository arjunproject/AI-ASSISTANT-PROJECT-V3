import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadAppConfig } from '../src/config/app-config.js';
import { inspectGoogleSheetsConfig } from '../src/config/google-sheets-config.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];
const ENV_KEYS = [
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_KEY_PATH',
] as const;
const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (typeof original === 'string') {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  }

  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('app config reads google sheets env from the project root and resolves local key path honestly', async () => {
  const temp = await createTempRoot('stage-5-google-sheets-env-');
  cleanups.push(temp.cleanup);

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  const keyDir = join(temp.root, 'keys');
  await mkdir(keyDir, { recursive: true });
  const keyPath = join(keyDir, 'service-account.json');
  await writeFile(
    keyPath,
    JSON.stringify({
      type: 'service_account',
      client_email: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    }),
    'utf8',
  );
  await writeFile(
    join(temp.root, '.env'),
    [
      'GOOGLE_SHEETS_SPREADSHEET_ID=1BCITr0ihBrTRr3qraW3jLObbW3Enbz-Io6Ki-9cRMvg',
      'GOOGLE_SERVICE_ACCOUNT_EMAIL=arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
      'GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./keys/service-account.json',
      '',
    ].join('\n'),
    'utf8',
  );

  const config = loadAppConfig({ projectRoot: temp.root });
  const inspection = await inspectGoogleSheetsConfig(config);

  assert.equal(config.googleSheetsSpreadsheetId, '1BCITr0ihBrTRr3qraW3jLObbW3Enbz-Io6Ki-9cRMvg');
  assert.equal(
    config.googleServiceAccountEmail,
    'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
  );
  assert.equal(config.googleServiceAccountKeyPath, keyPath);
  assert.equal(inspection.ready, true);
  assert.equal(inspection.serviceAccountKeyPath, keyPath);
  assert.equal(inspection.error, null);
});

test('google sheets config fails closed when key path does not exist', async () => {
  const temp = await createTempRoot('stage-5-google-sheets-missing-key-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    googleSheetsSpreadsheetId: '1BCITr0ihBrTRr3qraW3jLObbW3Enbz-Io6Ki-9cRMvg',
    googleServiceAccountEmail: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    googleServiceAccountKeyPath: join(temp.root, 'missing-service-account.json'),
  });

  const inspection = await inspectGoogleSheetsConfig(config);

  assert.equal(inspection.ready, false);
  assert.equal(
    inspection.error,
    `GOOGLE_SERVICE_ACCOUNT_KEY_PATH does not exist: ${join(temp.root, 'missing-service-account.json')}`,
  );
});

test('secondary runtime profile shares registry files with primary runtime and disables spreadsheet access by default', async () => {
  const temp = await createTempRoot('stage-7-bot2-config-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    runtimeProfile: 'secondary',
  });
  const inspection = await inspectGoogleSheetsConfig(config);

  assert.equal(config.runtimeProfile, 'secondary');
  assert.equal(config.runtimeRoot, join(temp.root, '.runtime-bot2'));
  assert.equal(config.whatsappAuthDir, join(temp.root, '.runtime-bot2', 'whatsapp', 'auth'));
  assert.equal(config.whatsappQrFilePath, join(temp.root, '.runtime-bot2', 'whatsapp', 'qr', 'login-qr.png'));
  assert.equal(config.accessRegistryFilePath, join(temp.root, '.runtime', 'access', 'admin-registry.json'));
  assert.equal(
    config.officialGroupWhitelistFilePath,
    join(temp.root, '.runtime', 'access', 'official-group-whitelist.json'),
  );
  assert.equal(config.dynamicPromptRegistryFilePath, join(temp.root, '.runtime', 'ai', 'dynamic-prompts.json'));
  assert.equal(config.dynamicPromptAuditFilePath, join(temp.root, '.runtime', 'ai', 'dynamic-prompt-audit.json'));
  assert.equal(config.botPrimaryNumber, '201507007785');
  assert.equal(config.spreadsheetReadEnabled, false);
  assert.equal(config.mirrorSyncEnabled, false);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.error, null);
});
