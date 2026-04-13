import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppConfig } from '../src/config/app-config.js';
import { createSpreadsheetReadService } from '../src/ai/spreadsheet-read-service.js';
import {
  type GoogleSheetsMirrorSheet,
  writeGoogleSheetsMirrorSheet,
} from '../src/google/google-sheets-mirror.js';
import { createTempRoot } from './test-helpers.js';

test('spreadsheet read service defaults to READY only for stok motor', async () => {
  const temp = await createTempRoot('mirror-read-');
  try {
    const config = loadAppConfig({
      projectRoot: temp.root,
      runtimeRoot: '.runtime',
      openAiApiKey: '',
      openAiTextModel: '',
    });

    const sheet: GoogleSheetsMirrorSheet = {
      spreadsheetId: 'test-sheet',
      spreadsheetTitle: 'Arjun Motor Project',
      sheetName: 'STOK MOTOR',
      sheetId: 0,
      syncedAt: new Date().toISOString(),
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'column-b-cutoff',
      lastDiscoveryRange: null,
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
      ],
      nonEmptyRowCount: 3,
      nonEmptyCellCount: 9,
      lastDataRow: 3,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
        { row: 2, col: 1, a1: 'A2', value: '1' },
        { row: 2, col: 2, a1: 'B2', value: 'Beat' },
        { row: 2, col: 13, a1: 'M2', value: 'TRUE' },
        { row: 3, col: 1, a1: 'A3', value: '2' },
        { row: 3, col: 2, a1: 'B3', value: 'Vario' },
        { row: 3, col: 13, a1: 'M3', value: 'FALSE' },
      ],
      pendingMutations: [],
    };

    await writeGoogleSheetsMirrorSheet(config, sheet);

    const service = createSpreadsheetReadService(config);
    const result = await service.readData({ sheet: 'STOK MOTOR' });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.STATUS, 'READY');
    assert.equal(result.rows[0]?.NO, '2');
    assert.equal(result.error, null);
  } finally {
    await temp.cleanup();
  }
});

test('spreadsheet read service supports includeSold and basic filters', async () => {
  const temp = await createTempRoot('mirror-read-');
  try {
    const config = loadAppConfig({
      projectRoot: temp.root,
      runtimeRoot: '.runtime',
      openAiApiKey: '',
      openAiTextModel: '',
    });

    const sheet: GoogleSheetsMirrorSheet = {
      spreadsheetId: 'test-sheet',
      spreadsheetTitle: 'Arjun Motor Project',
      sheetName: 'STOK MOTOR',
      sheetId: 0,
      syncedAt: new Date().toISOString(),
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'column-b-cutoff',
      lastDiscoveryRange: null,
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
      ],
      nonEmptyRowCount: 3,
      nonEmptyCellCount: 9,
      lastDataRow: 3,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
        { row: 2, col: 1, a1: 'A2', value: '1' },
        { row: 2, col: 2, a1: 'B2', value: 'Beat' },
        { row: 2, col: 13, a1: 'M2', value: 'TRUE' },
        { row: 3, col: 1, a1: 'A3', value: '2' },
        { row: 3, col: 2, a1: 'B3', value: 'Vario' },
        { row: 3, col: 13, a1: 'M3', value: 'FALSE' },
      ],
      pendingMutations: [],
    };

    await writeGoogleSheetsMirrorSheet(config, sheet);

    const service = createSpreadsheetReadService(config);
    const result = await service.readData({
      sheet: 'STOK MOTOR',
      includeSold: true,
      filters: [
        {
          field: 'NAMA MOTOR',
          operator: 'contains',
          value: 'vario',
        },
      ],
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.STATUS, 'READY');
    assert.equal(result.rows[0]?.NO, '2');
    assert.equal(result.filteredRowCount, 1);
  } finally {
    await temp.cleanup();
  }
});
