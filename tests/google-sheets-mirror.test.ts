import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGoogleSheetsMirrorSheet,
  computeLastNonEmptyRow,
  computeStokMotorLastDataRow,
  toA1,
} from '../src/google/google-sheets-mirror.js';
import type { GoogleSheetsSpreadsheetMetadata } from '../src/google/google-sheets-client.js';

const metadata: GoogleSheetsSpreadsheetMetadata = {
  spreadsheetId: 'spreadsheet-1',
  title: 'ARJUN MOTOR PROJECT',
  locale: 'in_ID',
  timeZone: 'Asia/Jakarta',
  sheets: [
    {
      sheetId: 1,
      title: 'STOK MOTOR',
      index: 0,
      rowCount: 1000,
      columnCount: 20,
    },
    {
      sheetId: 2,
      title: 'PENGELUARAN HARIAN',
      index: 1,
      rowCount: 1000,
      columnCount: 20,
    },
    {
      sheetId: 3,
      title: 'TOTAL ASET',
      index: 2,
      rowCount: 1000,
      columnCount: 20,
    },
  ],
};

test('stok motor cutoff keeps tracked data rows even when valid live edits land below the last non-empty NAMA MOTOR row', () => {
  const sheet = buildGoogleSheetsMirrorSheet(
    metadata,
    {
      requestedRange: 'STOK MOTOR',
      resolvedRange: '\'STOK MOTOR\'',
      returnedRange: '\'STOK MOTOR\'!A1:Q8',
      rowCount: 8,
      rows: [
        ['NO', 'NAMA MOTOR', 'TAHUN', 'CATATAN BARU'],
        ['1', 'Beat', '2015', 'siap'],
        ['2', 'Vario', '2016', 'cek'],
        ['3', '', '2017', 'edit sah di kolom data harus tetap ikut'],
        ['4', 'Scoopy', '2018', 'aktif'],
        ['', '', '', ''],
        ['', '', '', 'edit-manual-sah'],
        ['', '', '', ''],
      ],
    },
    'STOK MOTOR',
    '2026-04-12T00:00:00.000Z',
  );

  assert.equal(computeStokMotorLastDataRow([
    ['NO', 'NAMA MOTOR'],
    ['1', 'Beat'],
    ['2', 'Vario'],
    ['3', '', '2017', 'edit sah di kolom data harus tetap ikut'],
    ['4', 'Scoopy'],
    [],
    ['', '', '', 'edit-manual-sah'],
  ]), 7);
  assert.equal(sheet.lastDataRow, 7);
  assert.equal(sheet.nonEmptyRowCount, 6);
  assert.equal(sheet.valueCells.some((cell) => cell.a1 === 'D5' && cell.value === 'aktif'), true);
  assert.equal(
    sheet.valueCells.some((cell) => cell.a1 === 'D4' && cell.value === 'edit sah di kolom data harus tetap ikut'),
    true,
  );
  assert.equal(sheet.valueCells.some((cell) => cell.a1 === 'D7' && cell.value === 'edit-manual-sah'), true);
  assert.deepEqual(
    sheet.headerSnapshot.map((cell) => cell.value),
    ['NO', 'NAMA MOTOR', 'TAHUN', 'CATATAN BARU'],
  );
});

test('pengeluaran harian keeps sparse clusters without hardcoding one table', () => {
  const sheet = buildGoogleSheetsMirrorSheet(
    metadata,
    {
      requestedRange: 'PENGELUARAN HARIAN',
      resolvedRange: '\'PENGELUARAN HARIAN\'',
      returnedRange: '\'PENGELUARAN HARIAN\'!A1:H12',
      rowCount: 12,
      rows: [
        ['TANGGAL', 'KETERANGAN', 'NOMINAL', '', 'PONDOK', 'NOMINAL'],
        ['1 Jan', 'jajan', '10000', '', 'lampu', '50000'],
        ['', '', '', '', '', ''],
        ['5 Jan', 'bensin', '30000', '', '', ''],
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['RINGKASAN', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['TABEL BARU', 'YA', '', '', '', ''],
      ],
    },
    'PENGELUARAN HARIAN',
    '2026-04-12T00:00:00.000Z',
  );

  assert.equal(computeLastNonEmptyRow([
    ['A'],
    ['B'],
    [],
    ['C'],
  ]), 4);
  assert.equal(sheet.lastDataRow, 10);
  assert.equal(sheet.valueCells.some((cell) => cell.a1 === 'E2' && cell.value === 'lampu'), true);
  assert.equal(sheet.valueCells.some((cell) => cell.a1 === 'A10' && cell.value === 'TABEL BARU'), true);
});

test('total aset captures all active values sparsely and A1 coordinates stay stable', () => {
  const sheet = buildGoogleSheetsMirrorSheet(
    metadata,
    {
      requestedRange: 'TOTAL ASET',
      resolvedRange: '\'TOTAL ASET\'',
      returnedRange: '\'TOTAL ASET\'!A1:C6',
      rowCount: 6,
      rows: [
        ['Modal Awal', 'Rp100.000.000'],
        ['Aset Kendaraan', 'Rp50.000.000'],
        ['Kas', 'Rp10.000.000'],
        ['Tambahan', '', 'Catatan baru'],
      ],
    },
    'TOTAL ASET',
    '2026-04-12T00:00:00.000Z',
  );

  assert.equal(sheet.lastDataRow, 4);
  assert.equal(sheet.nonEmptyCellCount, 8);
  assert.equal(sheet.valueCells.some((cell) => cell.a1 === 'C4' && cell.value === 'Catatan baru'), true);
  assert.equal(toA1(1, 1), 'A1');
  assert.equal(toA1(20, 13), 'M20');
  assert.equal(toA1(5, 27), 'AA5');
});
