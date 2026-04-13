import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadAppConfig } from '../src/config/app-config.js';
import {
  inspectGoogleSheetsClientConfig,
  resolveGoogleSheetsReadRange,
} from '../src/google/google-sheets-client.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('google sheets client inspection fails closed when env email mismatches key file email', async () => {
  const temp = await createTempRoot('stage-5-google-sheets-client-mismatch-');
  cleanups.push(temp.cleanup);

  const keyDir = join(temp.root, 'keys');
  await mkdir(keyDir, { recursive: true });
  const keyPath = join(keyDir, 'service-account.json');
  await writeFile(
    keyPath,
    JSON.stringify({
      type: 'service_account',
      project_id: 'arjun-motor-project',
      client_email: 'other-service@arjun-motor-project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    }),
    'utf8',
  );

  const config = loadAppConfig({
    projectRoot: temp.root,
    googleSheetsSpreadsheetId: '1BCITr0ihBrTRr3qraW3jLObbW3Enbz-Io6Ki-9cRMvg',
    googleServiceAccountEmail: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    googleServiceAccountKeyPath: keyPath,
  });

  const inspection = await inspectGoogleSheetsClientConfig(config);

  assert.equal(inspection.ready, false);
  assert.match(inspection.error ?? '', /does not match client_email/i);
});

test('google sheets client resolves sheet ranges safely for Sheets API reads', () => {
  assert.equal(resolveGoogleSheetsReadRange('TOTAL ASET!A1:B20'), '\'TOTAL ASET\'!A1:B20');
  assert.equal(resolveGoogleSheetsReadRange('STOK MOTOR!A1:M20'), '\'STOK MOTOR\'!A1:M20');
  assert.equal(
    resolveGoogleSheetsReadRange('PENGELUARAN HARIAN!A1:F40'),
    '\'PENGELUARAN HARIAN\'!A1:F40',
  );
});
