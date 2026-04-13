import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadAppConfig } from '../src/config/app-config.js';
import {
  buildDefaultGoogleSheetsMirrorAuthorityState,
  readGoogleSheetsMirrorIndex,
  readGoogleSheetsMirrorSheet,
  writeGoogleSheetsMirrorIndex,
  writeGoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorIndex,
  type GoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorSheetName,
} from '../src/google/google-sheets-mirror.js';
import {
  syncGoogleSheetsMirror,
  verifyPersistedGoogleSheetsMirror,
} from '../src/google/google-sheets-mirror-sync.js';
import type {
  GoogleSheetsAuthResult,
  GoogleSheetsRangeSample,
  GoogleSheetsReadClient,
  GoogleSheetsSpreadsheetMetadata,
  GoogleSheetsTypedRangeSample,
  GoogleSheetsGridRangeSample,
} from '../src/google/google-sheets-client.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('live to mirror sync persists official mirror files and keeps valid STOK MOTOR live edits below old cutoff', async () => {
  const temp = await createTempRoot('stage-6-mirror-sync-live-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-6',
  });
  const fakeClient = createFakeReadClient({
    spreadsheetId: 'spreadsheet-1',
    title: 'ARJUN MOTOR PROJECT',
    locale: 'id_ID',
    timeZone: 'Asia/Jakarta',
    sheets: [
      { title: 'STOK MOTOR', sheetId: 0, rowCount: 200, columnCount: 13 },
      { title: 'PENGELUARAN HARIAN', sheetId: 1215570505, rowCount: 200, columnCount: 6 },
      { title: 'TOTAL ASET', sheetId: 1573138266, rowCount: 200, columnCount: 2 },
    ],
    ranges: new Map<string, string[][]>([
      [
        "STOK MOTOR!A:M",
        [
          ['NO', 'NAMA MOTOR', 'TAHUN', 'PLAT', 'SURAT-SURAT', 'TAHUN PLAT', 'PAJAK', 'HARGA JUAL', 'HARGA LAKU', 'TGL TERJUAL', 'LABA/RUGI', 'HARGA BELI', 'STATUS'],
          ['1', 'Beat Street', '2022', 'B 1234 CD', 'BPKB', '2027', '-', 'Rp18.500.000', '-', '-', '-', 'Rp15.200.000', 'FALSE'],
          [],
          ['', '', '', '', '', '', '', 'Rp8.500.000', '', '', '', '', 'FALSE'],
        ],
      ],
      [
        "PENGELUARAN HARIAN!A:F",
        [
          ['TANGGAL', 'KETERANGAN', 'NOMINAL'],
          ['13 April 2026', 'Bensin', '150000'],
        ],
      ],
      [
        "TOTAL ASET!A:B",
        [
          ['LABEL', 'NILAI'],
          ['Total Aset Kendaraan', 'Rp165.550.000'],
        ],
      ],
    ]),
  });

  const result = await syncGoogleSheetsMirror(config, {
    readClient: fakeClient,
    syncedAt: '2026-04-13T01:00:00.000Z',
  });

  const mirrorIndex = await readGoogleSheetsMirrorIndex(config);
  const stokMirror = await readGoogleSheetsMirrorSheet(config, 'STOK MOTOR');
  const pengeluaranMirror = await readGoogleSheetsMirrorSheet(config, 'PENGELUARAN HARIAN');
  const totalAsetMirror = await readGoogleSheetsMirrorSheet(config, 'TOTAL ASET');

  assert.equal(result.verification.sheetCount, 3);
  assert.equal(mirrorIndex.syncedAt, '2026-04-13T01:00:00.000Z');
  assert.equal(mirrorIndex.authorityState.syncAuthorityMode, 'live_authoritative');
  assert.equal(mirrorIndex.authorityState.writeSessionStatus, 'idle');
  assert.equal(mirrorIndex.authorityState.lastAuthoritativeSource, 'live_manual');
  assert.equal(stokMirror.lastDataRow, 4);
  assert.equal(
    stokMirror.valueCells.some((cell) => cell.a1 === 'H4' && cell.value === 'Rp8.500.000'),
    true,
  );
  assert.equal(
    stokMirror.valueCells.some((cell) => cell.a1 === 'M4' && cell.value === 'FALSE'),
    true,
  );
  assert.equal(pengeluaranMirror.lastDataRow, 2);
  assert.equal(totalAsetMirror.lastDataRow, 2);
});

test('post-persist verification fails closed when persisted mirror no longer matches the sync result', async () => {
  const temp = await createTempRoot('stage-6-mirror-sync-verify-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-6',
  });
  const fakeClient = createFakeReadClient({
    spreadsheetId: 'spreadsheet-1',
    title: 'ARJUN MOTOR PROJECT',
    locale: 'id_ID',
    timeZone: 'Asia/Jakarta',
    sheets: [
      { title: 'STOK MOTOR', sheetId: 0, rowCount: 200, columnCount: 13 },
      { title: 'PENGELUARAN HARIAN', sheetId: 1215570505, rowCount: 200, columnCount: 6 },
      { title: 'TOTAL ASET', sheetId: 1573138266, rowCount: 200, columnCount: 2 },
    ],
    ranges: new Map<string, string[][]>([
      ["STOK MOTOR!A:M", [['NO', 'NAMA MOTOR'], ['1', 'Beat']]],
      ["PENGELUARAN HARIAN!A:F", [['TANGGAL', 'KETERANGAN'], ['13 April 2026', 'Bensin']]],
      ["TOTAL ASET!A:B", [['LABEL', 'NILAI'], ['Total Aset Kendaraan', 'Rp165.550.000']]],
    ]),
  });

  const result = await syncGoogleSheetsMirror(config, {
    readClient: fakeClient,
    syncedAt: '2026-04-13T01:10:00.000Z',
  });

  const stokPath = join(config.runtimeRoot, 'mirror', 'stok-motor.json');
  const raw = JSON.parse(await readFile(stokPath, 'utf8')) as { valueCells: Array<{ value: string }> };
  raw.valueCells[1] = { ...raw.valueCells[1], value: 'Corrupted' };
  await writeFile(stokPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

  await assert.rejects(
    verifyPersistedGoogleSheetsMirror(config, result.mirrorIndex, result.mirrorSheets),
    /does not match the live sync result/i,
  );
});

test('active mirror write session keeps mirror authoritative only on scoped cells while live still wins outside the scope', async () => {
  const temp = await createTempRoot('stage-6-mirror-sync-authority-scope-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-6',
  });

  await seedMirrorState(config, {
    authorityState: {
      ...buildDefaultGoogleSheetsMirrorAuthorityState('2026-04-13T01:20:00.000Z'),
      syncAuthorityMode: 'mirror_authoritative',
      activeWriteSessionId: 'session-1',
      activeWriteScope: ['STOK MOTOR!H4:H4'],
      activeWriteSource: 'mirror_write_contract',
      writeSessionStatus: 'active',
      lastAuthoritativeSource: 'mirror_write_contract',
      updatedAt: '2026-04-13T01:20:00.000Z',
    },
    sheets: {
      stokMotor: {
        spreadsheetId: 'spreadsheet-1',
        spreadsheetTitle: 'ARJUN MOTOR PROJECT',
        sheetName: 'STOK MOTOR',
        sheetId: 0,
        syncedAt: '2026-04-13T01:20:00.000Z',
        mirrorMode: 'value-only-sparse',
        discoveryMode: 'column-b-cutoff',
        lastDiscoveryRange: 'STOK MOTOR!A:M',
        headerSnapshot: [
          { row: 1, col: 1, a1: 'A1', value: 'NO' },
          { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
          { row: 1, col: 8, a1: 'H1', value: 'HARGA JUAL' },
          { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
        ],
        nonEmptyRowCount: 3,
        nonEmptyCellCount: 9,
        lastDataRow: 4,
        valueCells: [
          { row: 1, col: 1, a1: 'A1', value: 'NO' },
          { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
          { row: 1, col: 8, a1: 'H1', value: 'HARGA JUAL' },
          { row: 1, col: 13, a1: 'M1', value: 'STATUS' },
          { row: 2, col: 1, a1: 'A2', value: '1' },
          { row: 2, col: 2, a1: 'B2', value: 'Beat Street' },
          { row: 4, col: 1, a1: 'A4', value: '3' },
          { row: 4, col: 4, a1: 'D4', value: 'CATATAN MIRROR LAMA' },
          { row: 4, col: 8, a1: 'H4', value: 'Rp8.500.000' },
        ],
        pendingMutations: [
          {
            mutationId: 'stok-r4-20260413012000',
            mutationType: 'update_cells',
            createdAt: '2026-04-13T01:20:00.000Z',
            updatedAt: '2026-04-13T01:20:00.000Z',
            targetRow: 4,
            writeRanges: ['STOK MOTOR!H4:H4'],
            cells: [
              {
                row: 4,
                col: 8,
                a1: 'H4',
                value: 'Rp8.500.000',
                valueKind: 'text',
                baselineValue: null,
              },
            ],
          },
        ],
      },
    },
  });

  const fakeClient = createFakeReadClient({
    spreadsheetId: 'spreadsheet-1',
    title: 'ARJUN MOTOR PROJECT',
    locale: 'id_ID',
    timeZone: 'Asia/Jakarta',
    sheets: [
      { title: 'STOK MOTOR', sheetId: 0, rowCount: 200, columnCount: 13 },
      { title: 'PENGELUARAN HARIAN', sheetId: 1215570505, rowCount: 200, columnCount: 6 },
      { title: 'TOTAL ASET', sheetId: 1573138266, rowCount: 200, columnCount: 2 },
    ],
    ranges: new Map<string, string[][]>([
      [
        'STOK MOTOR!A:M',
        [
          ['NO', 'NAMA MOTOR', 'TAHUN', 'PLAT', 'SURAT-SURAT', 'TAHUN PLAT', 'PAJAK', 'HARGA JUAL', 'HARGA LAKU', 'TGL TERJUAL', 'LABA/RUGI', 'HARGA BELI', 'STATUS'],
          ['1', 'Beat Street', '2022', 'B 1234 CD', 'BPKB', '2027', '-', 'Rp18.500.000', '-', '-', '-', 'Rp15.200.000', 'FALSE'],
          [],
          ['3', '', '', 'CATATAN LIVE BARU', '', '', '', '', '', '', '', '', 'FALSE'],
        ],
      ],
      [
        'PENGELUARAN HARIAN!A:F',
        [['TANGGAL', 'KETERANGAN', 'NOMINAL'], ['13 April 2026', 'Bensin', '150000']],
      ],
      [
        'TOTAL ASET!A:B',
        [['LABEL', 'NILAI'], ['Total Aset Kendaraan', 'Rp165.550.000']],
      ],
    ]),
  });

  await syncGoogleSheetsMirror(config, {
    readClient: fakeClient,
    syncedAt: '2026-04-13T01:21:00.000Z',
  });

  const mirrorIndex = await readGoogleSheetsMirrorIndex(config);
  const stokMirror = await readGoogleSheetsMirrorSheet(config, 'STOK MOTOR');
  assert.equal(mirrorIndex.authorityState.syncAuthorityMode, 'mirror_authoritative');
  assert.equal(mirrorIndex.authorityState.writeSessionStatus, 'active');
  assert.deepEqual(mirrorIndex.authorityState.activeWriteScope, ['STOK MOTOR!H4:H4']);
  assert.equal(stokMirror.pendingMutations.length, 1);
  assert.equal(stokMirror.valueCells.some((cell) => cell.a1 === 'H4' && cell.value === 'Rp8.500.000'), true);
  assert.equal(stokMirror.valueCells.some((cell) => cell.a1 === 'D4' && cell.value === 'CATATAN LIVE BARU'), true);
});

test('active mirror write session fails closed into conflict when manual live edit changes the same scoped cell', async () => {
  const temp = await createTempRoot('stage-6-mirror-sync-authority-conflict-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-6',
  });

  await seedMirrorState(config, {
    authorityState: {
      ...buildDefaultGoogleSheetsMirrorAuthorityState('2026-04-13T01:25:00.000Z'),
      syncAuthorityMode: 'mirror_authoritative',
      activeWriteSessionId: 'session-2',
      activeWriteScope: ['STOK MOTOR!H4:H4'],
      activeWriteSource: 'mirror_write_contract',
      writeSessionStatus: 'active',
      lastAuthoritativeSource: 'mirror_write_contract',
      updatedAt: '2026-04-13T01:25:00.000Z',
    },
    sheets: {
      stokMotor: {
        spreadsheetId: 'spreadsheet-1',
        spreadsheetTitle: 'ARJUN MOTOR PROJECT',
        sheetName: 'STOK MOTOR',
        sheetId: 0,
        syncedAt: '2026-04-13T01:25:00.000Z',
        mirrorMode: 'value-only-sparse',
        discoveryMode: 'column-b-cutoff',
        lastDiscoveryRange: 'STOK MOTOR!A:M',
        headerSnapshot: [
          { row: 1, col: 1, a1: 'A1', value: 'NO' },
          { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
          { row: 1, col: 8, a1: 'H1', value: 'HARGA JUAL' },
        ],
        nonEmptyRowCount: 3,
        nonEmptyCellCount: 8,
        lastDataRow: 4,
        valueCells: [
          { row: 1, col: 1, a1: 'A1', value: 'NO' },
          { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
          { row: 1, col: 8, a1: 'H1', value: 'HARGA JUAL' },
          { row: 2, col: 1, a1: 'A2', value: '1' },
          { row: 2, col: 2, a1: 'B2', value: 'Beat Street' },
          { row: 4, col: 1, a1: 'A4', value: '3' },
          { row: 4, col: 4, a1: 'D4', value: 'CATATAN LIVE BARU' },
          { row: 4, col: 8, a1: 'H4', value: 'Rp8.500.000' },
        ],
        pendingMutations: [
          {
            mutationId: 'stok-r4-20260413012500',
            mutationType: 'update_cells',
            createdAt: '2026-04-13T01:25:00.000Z',
            updatedAt: '2026-04-13T01:25:00.000Z',
            targetRow: 4,
            writeRanges: ['STOK MOTOR!H4:H4'],
            cells: [
              {
                row: 4,
                col: 8,
                a1: 'H4',
                value: 'Rp8.500.000',
                valueKind: 'text',
                baselineValue: null,
              },
            ],
          },
        ],
      },
    },
  });

  const fakeClient = createFakeReadClient({
    spreadsheetId: 'spreadsheet-1',
    title: 'ARJUN MOTOR PROJECT',
    locale: 'id_ID',
    timeZone: 'Asia/Jakarta',
    sheets: [
      { title: 'STOK MOTOR', sheetId: 0, rowCount: 200, columnCount: 13 },
      { title: 'PENGELUARAN HARIAN', sheetId: 1215570505, rowCount: 200, columnCount: 6 },
      { title: 'TOTAL ASET', sheetId: 1573138266, rowCount: 200, columnCount: 2 },
    ],
    ranges: new Map<string, string[][]>([
      [
        'STOK MOTOR!A:M',
        [
          ['NO', 'NAMA MOTOR', 'TAHUN', 'PLAT', 'SURAT-SURAT', 'TAHUN PLAT', 'PAJAK', 'HARGA JUAL', 'HARGA LAKU', 'TGL TERJUAL', 'LABA/RUGI', 'HARGA BELI', 'STATUS'],
          ['1', 'Beat Street', '2022', 'B 1234 CD', 'BPKB', '2027', '-', 'Rp18.500.000', '-', '-', '-', 'Rp15.200.000', 'FALSE'],
          [],
          ['3', '', '', 'CATATAN LIVE BARU', '', '', '', 'Rp9.999.000', '', '', '', '', 'FALSE'],
        ],
      ],
      [
        'PENGELUARAN HARIAN!A:F',
        [['TANGGAL', 'KETERANGAN', 'NOMINAL'], ['13 April 2026', 'Bensin', '150000']],
      ],
      [
        'TOTAL ASET!A:B',
        [['LABEL', 'NILAI'], ['Total Aset Kendaraan', 'Rp165.550.000']],
      ],
    ]),
  });

  await assert.rejects(
    syncGoogleSheetsMirror(config, {
      readClient: fakeClient,
      syncedAt: '2026-04-13T01:26:00.000Z',
    }),
    /conflict|conflicted/i,
  );

  const mirrorIndex = await readGoogleSheetsMirrorIndex(config);
  assert.equal(mirrorIndex.authorityState.syncAuthorityMode, 'conflict');
  assert.equal(mirrorIndex.authorityState.writeSessionStatus, 'conflict');
  assert.match(mirrorIndex.authorityState.lastAuthorityConflictReason ?? '', /conflict/i);
});

async function seedMirrorState(
  config: ReturnType<typeof loadAppConfig>,
  input: {
    authorityState?: GoogleSheetsMirrorIndex['authorityState'];
    sheets?: {
      stokMotor?: GoogleSheetsMirrorSheet;
      pengeluaranHarian?: GoogleSheetsMirrorSheet;
      totalAset?: GoogleSheetsMirrorSheet;
    };
  },
): Promise<void> {
  const stokMotor = input.sheets?.stokMotor ?? createEmptySheet('STOK MOTOR', 0);
  const pengeluaranHarian =
    input.sheets?.pengeluaranHarian ?? createEmptySheet('PENGELUARAN HARIAN', 1215570505);
  const totalAset = input.sheets?.totalAset ?? createEmptySheet('TOTAL ASET', 1573138266);

  await writeGoogleSheetsMirrorSheet(config, stokMotor);
  await writeGoogleSheetsMirrorSheet(config, pengeluaranHarian);
  await writeGoogleSheetsMirrorSheet(config, totalAset);

  const index: GoogleSheetsMirrorIndex = {
    spreadsheetId: 'spreadsheet-1',
    spreadsheetTitle: 'ARJUN MOTOR PROJECT',
    syncedAt: stokMotor.syncedAt,
    mirrorMode: 'value-only-sparse',
    sheetCount: 3,
    mirrorCellCount:
      stokMotor.nonEmptyCellCount + pengeluaranHarian.nonEmptyCellCount + totalAset.nonEmptyCellCount,
    sheets: [
      buildIndexEntry(stokMotor, 'stok-motor.json'),
      buildIndexEntry(pengeluaranHarian, 'pengeluaran-harian.json'),
      buildIndexEntry(totalAset, 'total-aset.json'),
    ],
    authorityState:
      input.authorityState ?? buildDefaultGoogleSheetsMirrorAuthorityState(stokMotor.syncedAt),
  };

  await writeGoogleSheetsMirrorIndex(config, index);
}

function buildIndexEntry(sheet: GoogleSheetsMirrorSheet, fileName: string): GoogleSheetsMirrorIndex['sheets'][number] {
  return {
    sheetName: sheet.sheetName,
    sheetId: sheet.sheetId,
    fileName,
    syncedAt: sheet.syncedAt,
    discoveryMode: sheet.discoveryMode,
    lastDiscoveryRange: sheet.lastDiscoveryRange,
    nonEmptyRowCount: sheet.nonEmptyRowCount,
    nonEmptyCellCount: sheet.nonEmptyCellCount,
    lastDataRow: sheet.lastDataRow,
  };
}

function createEmptySheet(
  sheetName: GoogleSheetsMirrorSheetName,
  sheetId: number,
): GoogleSheetsMirrorSheet {
  return {
    spreadsheetId: 'spreadsheet-1',
    spreadsheetTitle: 'ARJUN MOTOR PROJECT',
    sheetName,
    sheetId,
    syncedAt: '2026-04-13T01:00:00.000Z',
    mirrorMode: 'value-only-sparse',
    discoveryMode: sheetName === 'STOK MOTOR' ? 'column-b-cutoff' : 'used-range-sparse',
    lastDiscoveryRange: null,
    headerSnapshot: [],
    nonEmptyRowCount: 0,
    nonEmptyCellCount: 0,
    lastDataRow: 0,
    valueCells: [],
    pendingMutations: [],
  };
}

function createFakeReadClient(input: {
  spreadsheetId: string;
  title: string;
  locale: string;
  timeZone: string;
  sheets: Array<{
    title: GoogleSheetsMirrorSheetName;
    sheetId: number;
    rowCount: number;
    columnCount: number;
  }>;
  ranges: Map<string, string[][]>;
}): GoogleSheetsReadClient {
  const metadata: GoogleSheetsSpreadsheetMetadata = {
    spreadsheetId: input.spreadsheetId,
    title: input.title,
    locale: input.locale,
    timeZone: input.timeZone,
    sheets: input.sheets.map((sheet, index) => ({
      sheetId: sheet.sheetId,
      title: sheet.title,
      index,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
    })),
  };

  return {
    inspect() {
      return {
        ready: true,
        spreadsheetId: input.spreadsheetId,
        serviceAccountEmail: 'test@example.com',
        serviceAccountKeyPath: 'C:\\temp\\service-account.json',
        projectId: 'test-project',
        error: null,
      };
    },
    async authenticate(): Promise<GoogleSheetsAuthResult> {
      return {
        serviceAccountEmail: 'test@example.com',
        spreadsheetId: input.spreadsheetId,
        accessTokenPresent: true,
      };
    },
    async readSpreadsheetMetadata(): Promise<GoogleSheetsSpreadsheetMetadata> {
      return metadata;
    },
    async readRanges(ranges: readonly string[]): Promise<GoogleSheetsRangeSample[]> {
      return ranges.map((range) => {
        const rows = input.ranges.get(range) ?? [];
        return {
          requestedRange: range,
          resolvedRange: range,
          returnedRange: range,
          rowCount: rows.length,
          rows,
        };
      });
    },
    async readRangesWithRender(
      _ranges: readonly string[],
      _valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA',
    ): Promise<GoogleSheetsTypedRangeSample[]> {
      throw new Error('readRangesWithRender should not be called by this test.');
    },
    async readGridRanges(_ranges: readonly string[]): Promise<GoogleSheetsGridRangeSample[]> {
      throw new Error('readGridRanges should not be called by this test.');
    },
    async readSheetValues(sheetName: string): Promise<GoogleSheetsRangeSample> {
      const range = `${sheetName}`;
      return {
        requestedRange: range,
        resolvedRange: range,
        returnedRange: range,
        rowCount: 0,
        rows: [],
      };
    },
  };
}
