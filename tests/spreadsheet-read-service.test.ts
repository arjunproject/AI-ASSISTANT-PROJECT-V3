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

test('spreadsheet read service supports whole-row query across all searchable cells', async () => {
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
        { row: 1, col: 4, a1: 'D1', value: 'PLAT' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
      ],
      nonEmptyRowCount: 3,
      nonEmptyCellCount: 12,
      lastDataRow: 3,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 4, a1: 'D1', value: 'PLAT' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
        { row: 2, col: 1, a1: 'A2', value: '1' },
        { row: 2, col: 2, a1: 'B2', value: 'Beat' },
        { row: 2, col: 4, a1: 'D2', value: 'S 1234 AA' },
        { row: 2, col: 13, a1: 'M2', value: 'FALSE' },
        { row: 3, col: 1, a1: 'A3', value: '2' },
        { row: 3, col: 2, a1: 'B3', value: 'Vario' },
        { row: 3, col: 4, a1: 'D3', value: 'W 9988 BB' },
        { row: 3, col: 13, a1: 'M3', value: 'FALSE' },
      ],
      pendingMutations: [],
    };

    await writeGoogleSheetsMirrorSheet(config, sheet);

    const service = createSpreadsheetReadService(config);
    const result = await service.readData({
      sheet: 'STOK MOTOR',
      query: '9988 bb',
      includeSold: true,
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.NO, '2');
    assert.equal(result.rows[0]?.PLAT, 'W 9988 BB');
  } finally {
    await temp.cleanup();
  }
});

test('spreadsheet read service preserves duplicate headers instead of overwriting later columns', async () => {
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
      sheetName: 'PENGELUARAN HARIAN',
      sheetId: 1,
      syncedAt: new Date().toISOString(),
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'used-range-sparse',
      lastDiscoveryRange: null,
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'TANGGAL' },
        { row: 1, col: 2, a1: 'B1', value: 'KETERANGAN' },
        { row: 1, col: 3, a1: 'C1', value: 'NOMINAL' },
        { row: 1, col: 4, a1: 'D1', value: 'PENGELUARAN PONDOK' },
        { row: 1, col: 5, a1: 'E1', value: 'NOMINAL' },
      ],
      nonEmptyRowCount: 2,
      nonEmptyCellCount: 10,
      lastDataRow: 2,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'TANGGAL' },
        { row: 1, col: 2, a1: 'B1', value: 'KETERANGAN' },
        { row: 1, col: 3, a1: 'C1', value: 'NOMINAL' },
        { row: 1, col: 4, a1: 'D1', value: 'PENGELUARAN PONDOK' },
        { row: 1, col: 5, a1: 'E1', value: 'NOMINAL' },
        { row: 2, col: 1, a1: 'A2', value: '20 Februari 2026' },
        { row: 2, col: 2, a1: 'B2', value: 'makan' },
        { row: 2, col: 3, a1: 'C2', value: 'Rp25.000' },
        { row: 2, col: 4, a1: 'D2', value: 'obat pondok' },
        { row: 2, col: 5, a1: 'E2', value: 'Rp100.000' },
      ],
      pendingMutations: [],
    };

    await writeGoogleSheetsMirrorSheet(config, sheet);

    const service = createSpreadsheetReadService(config);
    const result = await service.readData({
      sheet: 'PENGELUARAN HARIAN',
      query: '100.000',
    });

    assert.deepEqual(result.headers, [
      'TANGGAL',
      'KETERANGAN',
      'NOMINAL [C]',
      'PENGELUARAN PONDOK',
      'NOMINAL [E]',
    ]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.['NOMINAL [C]'], 'Rp25.000');
    assert.equal(result.rows[0]?.['NOMINAL [E]'], 'Rp100.000');
  } finally {
    await temp.cleanup();
  }
});

test('spreadsheet read service treats TOTAL ASET as label-value rows instead of fake headers', async () => {
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
      sheetName: 'TOTAL ASET',
      sheetId: 2,
      syncedAt: new Date().toISOString(),
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'used-range-sparse',
      lastDiscoveryRange: null,
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'Modal Awal' },
        { row: 1, col: 2, a1: 'B1', value: 'Rp124.000.000' },
      ],
      nonEmptyRowCount: 3,
      nonEmptyCellCount: 6,
      lastDataRow: 3,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'Modal Awal' },
        { row: 1, col: 2, a1: 'B1', value: 'Rp124.000.000' },
        { row: 2, col: 1, a1: 'A2', value: 'Total Aset Kendaraan' },
        { row: 2, col: 2, a1: 'B2', value: 'Rp165.550.000' },
        { row: 3, col: 1, a1: 'A3', value: 'Total Pengeluaran' },
        { row: 3, col: 2, a1: 'B3', value: 'Rp21.839.015' },
      ],
      pendingMutations: [],
    };

    await writeGoogleSheetsMirrorSheet(config, sheet);

    const service = createSpreadsheetReadService(config);
    const result = await service.readData({
      sheet: 'TOTAL ASET',
      query: 'aset kendaraan',
    });

    assert.deepEqual(result.headers, ['ITEM', 'NILAI']);
    assert.equal(result.rowCount, 3);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      ITEM: 'Total Aset Kendaraan',
      NILAI: 'Rp165.550.000',
    });
  } finally {
    await temp.cleanup();
  }
});

test('spreadsheet read service skips STOK MOTOR placeholder rows that only contain structural defaults', async () => {
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
        { row: 2, col: 13, a1: 'M2', value: 'FALSE' },
        { row: 3, col: 1, a1: 'A3', value: '2' },
        { row: 3, col: 13, a1: 'M3', value: 'FALSE' },
      ],
      pendingMutations: [],
    };

    await writeGoogleSheetsMirrorSheet(config, sheet);

    const service = createSpreadsheetReadService(config);
    const result = await service.readData({
      sheet: 'STOK MOTOR',
      includeSold: true,
    });

    assert.equal(result.rowCount, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.NO, '1');
  } finally {
    await temp.cleanup();
  }
});

test('spreadsheet read service keeps full STOK MOTOR records instead of partial field subsets', async () => {
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
        { row: 1, col: 4, a1: 'D1', value: 'PLAT' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
      ],
      nonEmptyRowCount: 2,
      nonEmptyCellCount: 8,
      lastDataRow: 2,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 4, a1: 'D1', value: 'PLAT' },
        { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
        { row: 2, col: 1, a1: 'A2', value: '23' },
        { row: 2, col: 2, a1: 'B2', value: 'beat' },
        { row: 2, col: 4, a1: 'D2', value: 'S 1234 AA' },
        { row: 2, col: 13, a1: 'M2', value: 'FALSE' },
      ],
      pendingMutations: [],
    };

    await writeGoogleSheetsMirrorSheet(config, sheet);

    const service = createSpreadsheetReadService(config);
    const result = await service.readData({
      sheet: 'STOK MOTOR',
      includeSold: true,
    });

    assert.equal(result.rows.length, 1);
    assert.deepEqual(Object.keys(result.rows[0] ?? {}), [
      'NO',
      'NAMA MOTOR',
      'TAHUN',
      'PLAT',
      'SURAT-SURAT',
      'TAHUN PLAT',
      'PAJAK',
      'HARGA JUAL',
      'HARGA LAKU',
      'TGL TERJUAL',
      'LABA/RUGI',
      'HARGA BELI',
      'STATUS',
    ]);
    assert.equal(result.rows[0]?.PLAT, 'S 1234 AA');
    assert.equal(result.rows[0]?.TAHUN, '-');
    assert.equal(result.rows[0]?.STATUS, 'READY');
  } finally {
    await temp.cleanup();
  }
});
