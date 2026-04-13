import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppConfig } from '../src/config/app-config.js';
import {
  createGoogleSheetsMirrorAppendRowMutation,
  createGoogleSheetsMirrorConfirmSoldMutation,
  createGoogleSheetsMirrorDeleteRowMutation,
  createGoogleSheetsMirrorUpdateCellsMutation,
  inspectGoogleSheetsMirrorCellEligibility,
  resolveMirrorAppendTargetRow,
} from '../src/google/google-sheets-mirror-write.js';
import {
  buildDefaultGoogleSheetsMirrorAuthorityState,
  readGoogleSheetsMirrorIndex,
  writeGoogleSheetsMirrorIndex,
  writeGoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorIndex,
  type GoogleSheetsMirrorSheet,
} from '../src/google/google-sheets-mirror.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('sacred zone policy blocks TOTAL ASET and sacred STOK MOTOR cells', () => {
  assert.deepEqual(inspectGoogleSheetsMirrorCellEligibility('TOTAL ASET', 2, 1), {
    allowed: false,
    reason: 'TOTAL ASET is full read only.',
  });
  assert.deepEqual(inspectGoogleSheetsMirrorCellEligibility('STOK MOTOR', 1, 2), {
    allowed: false,
    reason: 'STOK MOTOR header row is sacred and read only.',
  });
  assert.deepEqual(inspectGoogleSheetsMirrorCellEligibility('STOK MOTOR', 61, 1), {
    allowed: false,
    reason: 'STOK MOTOR column A is sacred and read only.',
  });
  assert.deepEqual(inspectGoogleSheetsMirrorCellEligibility('STOK MOTOR', 61, 11), {
    allowed: false,
    reason: 'STOK MOTOR column K is sacred and read only.',
  });
  assert.equal(inspectGoogleSheetsMirrorCellEligibility('PENGELUARAN HARIAN', 2, 3).allowed, true);
});

test('STOK MOTOR append target row follows last active data row and skips sacred K in write ranges', async () => {
  const temp = await createTempRoot('stage-6-mirror-write-stok-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root });
  await seedMirror(config, {
    stokMotor: {
      spreadsheetId: 'spreadsheet-1',
      spreadsheetTitle: 'ARJUN MOTOR PROJECT',
      sheetName: 'STOK MOTOR',
      sheetId: 0,
      syncedAt: '2026-04-12T00:00:00.000Z',
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'column-b-cutoff',
      lastDiscoveryRange: "'STOK MOTOR'!A1:M60",
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 11, a1: 'K1', value: 'LABA/RUGI' },
      ],
      nonEmptyRowCount: 60,
      nonEmptyCellCount: 10,
      lastDataRow: 60,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 11, a1: 'K1', value: 'LABA/RUGI' },
        { row: 60, col: 1, a1: 'A60', value: '59' },
        { row: 60, col: 2, a1: 'B60', value: 'vario kzr' },
        { row: 60, col: 12, a1: 'L60', value: 'Rp6.700.000' },
      ],
      pendingMutations: [],
    },
  });

  const stokMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'STOK MOTOR'),
  );
  assert.equal(resolveMirrorAppendTargetRow(stokMirror), 61);

  const mutation = await createGoogleSheetsMirrorAppendRowMutation(config, {
    sheetName: 'STOK MOTOR',
    cells: [
      { col: 2, value: 'beat test' },
      { col: 10, value: '12 April 2026' },
      { col: 12, value: 'Rp6.100.000' },
      { col: 13, value: false },
    ],
  });

  assert.equal(mutation.targetRow, 61);

  const updatedMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'STOK MOTOR'),
  );
  const updatedIndex = await readGoogleSheetsMirrorIndex(config);
  assert.equal(updatedMirror.lastDataRow, 61);
  assert.equal(updatedMirror.pendingMutations.length, 1);
  assert.deepEqual(updatedMirror.pendingMutations[0]?.writeRanges, [
    'STOK MOTOR!B61:B61',
    'STOK MOTOR!J61:J61',
    'STOK MOTOR!L61:M61',
  ]);
  assert.equal(updatedIndex.authorityState.syncAuthorityMode, 'mirror_authoritative');
  assert.equal(updatedIndex.authorityState.writeSessionStatus, 'active');
  assert.equal(updatedIndex.authorityState.activeWriteSource, 'mirror_write_contract');
  assert.deepEqual(updatedIndex.authorityState.activeWriteScope, [
    'STOK MOTOR!B61:B61',
    'STOK MOTOR!J61:J61',
    'STOK MOTOR!L61:M61',
  ]);
});

test('multi append queues three STOK MOTOR rows in one official mutation round', async () => {
  const temp = await createTempRoot('stage-6-mirror-write-stok-multi-append-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root });
  await seedMirror(config, {
    stokMotor: {
      spreadsheetId: 'spreadsheet-1',
      spreadsheetTitle: 'ARJUN MOTOR PROJECT',
      sheetName: 'STOK MOTOR',
      sheetId: 0,
      syncedAt: '2026-04-12T00:00:00.000Z',
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'column-b-cutoff',
      lastDiscoveryRange: "'STOK MOTOR'!A1:M60",
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 11, a1: 'K1', value: 'LABA/RUGI' },
      ],
      nonEmptyRowCount: 60,
      nonEmptyCellCount: 6,
      lastDataRow: 60,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 11, a1: 'K1', value: 'LABA/RUGI' },
        { row: 60, col: 1, a1: 'A60', value: '59' },
        { row: 60, col: 2, a1: 'B60', value: 'vario kzr' },
        { row: 60, col: 12, a1: 'L60', value: 'Rp6.700.000' },
      ],
      pendingMutations: [],
    },
  });

  const first = await createGoogleSheetsMirrorAppendRowMutation(config, {
    sheetName: 'STOK MOTOR',
    cells: [
      { col: 2, value: 'runtime multi 1' },
      { col: 12, value: 6100000 },
      { col: 13, value: false },
    ],
  });
  const second = await createGoogleSheetsMirrorAppendRowMutation(config, {
    sheetName: 'STOK MOTOR',
    cells: [
      { col: 2, value: 'runtime multi 2' },
      { col: 12, value: 6200000 },
      { col: 13, value: false },
    ],
  });
  const third = await createGoogleSheetsMirrorAppendRowMutation(config, {
    sheetName: 'STOK MOTOR',
    cells: [
      { col: 2, value: 'runtime multi 3' },
      { col: 12, value: 6300000 },
      { col: 13, value: false },
    ],
  });

  assert.equal(first.targetRow, 61);
  assert.equal(second.targetRow, 62);
  assert.equal(third.targetRow, 63);

  const updatedMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'STOK MOTOR'),
  );
  assert.equal(updatedMirror.lastDataRow, 63);
  assert.equal(updatedMirror.pendingMutations.length, 3);
  assert.deepEqual(
    updatedMirror.pendingMutations.map((entry) => entry.targetRow),
    [61, 62, 63],
  );
});

test('PENGELUARAN HARIAN mutation is persisted to official mirror and index without creating blank rows', async () => {
  const temp = await createTempRoot('stage-6-mirror-write-pengeluaran-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root });
  await seedMirror(config, {
    pengeluaranHarian: {
      spreadsheetId: 'spreadsheet-1',
      spreadsheetTitle: 'ARJUN MOTOR PROJECT',
      sheetName: 'PENGELUARAN HARIAN',
      sheetId: 1215570505,
      syncedAt: '2026-04-12T00:00:00.000Z',
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'used-range-sparse',
      lastDiscoveryRange: "'PENGELUARAN HARIAN'!A1:F66",
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'TANGGAL' },
        { row: 1, col: 2, a1: 'B1', value: 'KETERANGAN' },
        { row: 1, col: 3, a1: 'C1', value: 'NOMINAL' },
      ],
      nonEmptyRowCount: 66,
      nonEmptyCellCount: 6,
      lastDataRow: 66,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'TANGGAL' },
        { row: 1, col: 2, a1: 'B1', value: 'KETERANGAN' },
        { row: 1, col: 3, a1: 'C1', value: 'NOMINAL' },
        { row: 66, col: 1, a1: 'A66', value: '9 April 2026' },
        { row: 66, col: 2, a1: 'B66', value: 'RUNTIME EXPENSE ONLY KETERANGAN 1775736270022' },
        { row: 66, col: 3, a1: 'C66', value: 'Rp43.131' },
      ],
      pendingMutations: [],
    },
  });

  const mutation = await createGoogleSheetsMirrorAppendRowMutation(config, {
    sheetName: 'PENGELUARAN HARIAN',
    cells: [
      { col: 1, value: '12 April 2026' },
      { col: 2, value: 'RUNTIME MIRROR WRITE TEST' },
      { col: 3, value: 4321 },
    ],
  });

  assert.equal(mutation.targetRow, 67);

  const updatedMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'PENGELUARAN HARIAN'),
  );
  assert.equal(updatedMirror.lastDataRow, 67);
  assert.equal(updatedMirror.pendingMutations.length, 1);
  assert.deepEqual(
    updatedMirror.valueCells.filter((cell) => cell.row === 67),
    [
      { row: 67, col: 1, a1: 'A67', value: '12 April 2026' },
      { row: 67, col: 2, a1: 'B67', value: 'RUNTIME MIRROR WRITE TEST' },
      { row: 67, col: 3, a1: 'C67', value: '4321' },
    ],
  );

  const updatedIndex = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorIndex(config),
  );
  const entry = updatedIndex.sheets.find((sheet) => sheet.sheetName === 'PENGELUARAN HARIAN');
  assert.equal(entry?.lastDataRow, 67);
  assert.equal(entry?.nonEmptyCellCount, 9);
});

test('STOK MOTOR update and confirm sold keep the same row and skip sacred column K', async () => {
  const temp = await createTempRoot('stage-6-mirror-write-stok-update-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root });
  await seedMirror(config, {
    stokMotor: {
      spreadsheetId: 'spreadsheet-1',
      spreadsheetTitle: 'ARJUN MOTOR PROJECT',
      sheetName: 'STOK MOTOR',
      sheetId: 0,
      syncedAt: '2026-04-12T00:00:00.000Z',
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'column-b-cutoff',
      lastDiscoveryRange: "'STOK MOTOR'!A1:M61",
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 11, a1: 'K1', value: 'LABA/RUGI' },
      ],
      nonEmptyRowCount: 61,
      nonEmptyCellCount: 12,
      lastDataRow: 61,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 1, col: 11, a1: 'K1', value: 'LABA/RUGI' },
        { row: 61, col: 2, a1: 'B61', value: 'runtime test unit' },
        { row: 61, col: 5, a1: 'E61', value: 'Lengkap hidup' },
        { row: 61, col: 8, a1: 'H61', value: 'Rp15.000.000' },
        { row: 61, col: 12, a1: 'L61', value: 'Rp13.000.000' },
        { row: 61, col: 13, a1: 'M61', value: 'FALSE' },
      ],
      pendingMutations: [],
    },
  });

  const updateMutation = await createGoogleSheetsMirrorUpdateCellsMutation(config, {
    sheetName: 'STOK MOTOR',
    targetRow: 61,
    cells: [
      { col: 4, value: 'W TEST' },
      { col: 8, value: 15500000 },
      { col: 12, value: 13100000 },
    ],
  });

  assert.equal(updateMutation.targetRow, 61);

  let updatedMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'STOK MOTOR'),
  );
  assert.equal(updatedMirror.pendingMutations.length, 1);
  assert.deepEqual(updatedMirror.pendingMutations[0]?.writeRanges, [
    'STOK MOTOR!D61:D61',
    'STOK MOTOR!H61:H61',
    'STOK MOTOR!L61:L61',
  ]);

  const soldMutation = await createGoogleSheetsMirrorConfirmSoldMutation(config, {
    targetRow: 61,
    salePrice: 14900000,
    soldAt: 'Minggu, 12 April 2026',
  });

  updatedMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'STOK MOTOR'),
  );
  assert.equal(updatedMirror.pendingMutations.length, 2);
  assert.equal(soldMutation.mutationType, 'update_cells');
  assert.deepEqual(updatedMirror.pendingMutations[1]?.writeRanges, [
    'STOK MOTOR!I61:J61',
    'STOK MOTOR!M61:M61',
  ]);
});

test('delete contract clears only writable cells and rolls last active row back when STOK MOTOR name becomes empty', async () => {
  const temp = await createTempRoot('stage-6-mirror-write-delete-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root });
  await seedMirror(config, {
    stokMotor: {
      spreadsheetId: 'spreadsheet-1',
      spreadsheetTitle: 'ARJUN MOTOR PROJECT',
      sheetName: 'STOK MOTOR',
      sheetId: 0,
      syncedAt: '2026-04-12T00:00:00.000Z',
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'column-b-cutoff',
      lastDiscoveryRange: "'STOK MOTOR'!A1:M61",
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
      ],
      nonEmptyRowCount: 61,
      nonEmptyCellCount: 8,
      lastDataRow: 61,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'NO' },
        { row: 1, col: 2, a1: 'B1', value: 'NAMA MOTOR' },
        { row: 60, col: 2, a1: 'B60', value: 'vario' },
        { row: 61, col: 2, a1: 'B61', value: 'runtime test unit' },
        { row: 61, col: 8, a1: 'H61', value: 'Rp15.000.000' },
        { row: 61, col: 9, a1: 'I61', value: 'Rp14.900.000' },
        { row: 61, col: 10, a1: 'J61', value: 'Minggu, 12 April 2026' },
        { row: 61, col: 12, a1: 'L61', value: 'Rp13.100.000' },
      ],
      pendingMutations: [],
    },
    pengeluaranHarian: {
      spreadsheetId: 'spreadsheet-1',
      spreadsheetTitle: 'ARJUN MOTOR PROJECT',
      sheetName: 'PENGELUARAN HARIAN',
      sheetId: 1215570505,
      syncedAt: '2026-04-12T00:00:00.000Z',
      mirrorMode: 'value-only-sparse',
      discoveryMode: 'used-range-sparse',
      lastDiscoveryRange: "'PENGELUARAN HARIAN'!A1:F67",
      headerSnapshot: [
        { row: 1, col: 1, a1: 'A1', value: 'TANGGAL' },
      ],
      nonEmptyRowCount: 67,
      nonEmptyCellCount: 4,
      lastDataRow: 67,
      valueCells: [
        { row: 1, col: 1, a1: 'A1', value: 'TANGGAL' },
        { row: 66, col: 1, a1: 'A66', value: '9 April 2026' },
        { row: 67, col: 1, a1: 'A67', value: '12 April 2026' },
        { row: 67, col: 2, a1: 'B67', value: 'runtime expense' },
      ],
      pendingMutations: [],
    },
  });

  const stokDelete = await createGoogleSheetsMirrorDeleteRowMutation(config, {
    sheetName: 'STOK MOTOR',
    targetRow: 61,
  });
  const pengeluaranDelete = await createGoogleSheetsMirrorDeleteRowMutation(config, {
    sheetName: 'PENGELUARAN HARIAN',
    targetRow: 67,
  });

  const stokMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'STOK MOTOR'),
  );
  const pengeluaranMirror = await import('../src/google/google-sheets-mirror.js').then((module) =>
    module.readGoogleSheetsMirrorSheet(config, 'PENGELUARAN HARIAN'),
  );

  assert.equal(stokDelete.mutationType, 'update_cells');
  assert.equal(pengeluaranDelete.mutationType, 'update_cells');
  assert.equal(stokMirror.lastDataRow, 60);
  assert.equal(pengeluaranMirror.lastDataRow, 66);
  assert.deepEqual(stokMirror.pendingMutations[0]?.writeRanges, [
    'STOK MOTOR!B61:J61',
    'STOK MOTOR!L61:M61',
  ]);
  assert.deepEqual(stokMirror.valueCells.filter((cell) => cell.row === 61), []);
  assert.deepEqual(pengeluaranMirror.pendingMutations[0]?.writeRanges, [
    'PENGELUARAN HARIAN!A67:F67',
  ]);
});

async function seedMirror(
  config: ReturnType<typeof loadAppConfig>,
  sheets: {
    stokMotor?: GoogleSheetsMirrorSheet;
    pengeluaranHarian?: GoogleSheetsMirrorSheet;
    totalAset?: GoogleSheetsMirrorSheet;
  },
): Promise<void> {
  const stokMotor = sheets.stokMotor ?? createEmptySheet('STOK MOTOR', 0);
  const pengeluaranHarian =
    sheets.pengeluaranHarian ?? createEmptySheet('PENGELUARAN HARIAN', 1215570505);
  const totalAset = sheets.totalAset ?? createEmptySheet('TOTAL ASET', 1573138266);

  await writeGoogleSheetsMirrorSheet(config, stokMotor);
  await writeGoogleSheetsMirrorSheet(config, pengeluaranHarian);
  await writeGoogleSheetsMirrorSheet(config, totalAset);

  const index: GoogleSheetsMirrorIndex = {
    spreadsheetId: 'spreadsheet-1',
    spreadsheetTitle: 'ARJUN MOTOR PROJECT',
    syncedAt: '2026-04-12T00:00:00.000Z',
    mirrorMode: 'value-only-sparse',
    sheetCount: 3,
    mirrorCellCount:
      stokMotor.nonEmptyCellCount + pengeluaranHarian.nonEmptyCellCount + totalAset.nonEmptyCellCount,
    sheets: [
      {
        sheetName: 'STOK MOTOR',
        sheetId: stokMotor.sheetId,
        fileName: 'stok-motor.json',
        syncedAt: stokMotor.syncedAt,
        discoveryMode: stokMotor.discoveryMode,
        lastDiscoveryRange: stokMotor.lastDiscoveryRange,
        nonEmptyRowCount: stokMotor.nonEmptyRowCount,
        nonEmptyCellCount: stokMotor.nonEmptyCellCount,
        lastDataRow: stokMotor.lastDataRow,
      },
      {
        sheetName: 'PENGELUARAN HARIAN',
        sheetId: pengeluaranHarian.sheetId,
        fileName: 'pengeluaran-harian.json',
        syncedAt: pengeluaranHarian.syncedAt,
        discoveryMode: pengeluaranHarian.discoveryMode,
        lastDiscoveryRange: pengeluaranHarian.lastDiscoveryRange,
        nonEmptyRowCount: pengeluaranHarian.nonEmptyRowCount,
        nonEmptyCellCount: pengeluaranHarian.nonEmptyCellCount,
        lastDataRow: pengeluaranHarian.lastDataRow,
      },
      {
        sheetName: 'TOTAL ASET',
        sheetId: totalAset.sheetId,
        fileName: 'total-aset.json',
        syncedAt: totalAset.syncedAt,
        discoveryMode: totalAset.discoveryMode,
        lastDiscoveryRange: totalAset.lastDiscoveryRange,
        nonEmptyRowCount: totalAset.nonEmptyRowCount,
        nonEmptyCellCount: totalAset.nonEmptyCellCount,
        lastDataRow: totalAset.lastDataRow,
      },
    ],
    authorityState: buildDefaultGoogleSheetsMirrorAuthorityState('2026-04-12T00:00:00.000Z'),
  };

  await writeGoogleSheetsMirrorIndex(config, index);
}

function createEmptySheet(
  sheetName: GoogleSheetsMirrorSheet['sheetName'],
  sheetId: number,
): GoogleSheetsMirrorSheet {
  return {
    spreadsheetId: 'spreadsheet-1',
    spreadsheetTitle: 'ARJUN MOTOR PROJECT',
    sheetName,
    sheetId,
    syncedAt: '2026-04-12T00:00:00.000Z',
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
