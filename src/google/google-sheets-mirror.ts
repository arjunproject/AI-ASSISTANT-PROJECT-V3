import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppConfig } from '../config/app-config.js';
import type {
  GoogleSheetsRangeSample,
  GoogleSheetsSpreadsheetMetadata,
} from './google-sheets-client.js';

export const GOOGLE_SHEETS_MIRROR_SHEET_NAMES = [
  'STOK MOTOR',
  'PENGELUARAN HARIAN',
  'TOTAL ASET',
] as const;

export type GoogleSheetsMirrorSheetName = (typeof GOOGLE_SHEETS_MIRROR_SHEET_NAMES)[number];

export interface GoogleSheetsMirrorValueCell {
  row: number;
  col: number;
  a1: string;
  value: string;
}

export type GoogleSheetsMirrorMutationValue = string | number | boolean;

export interface GoogleSheetsMirrorPendingMutationCell {
  row: number;
  col: number;
  a1: string;
  value: GoogleSheetsMirrorMutationValue;
  valueKind: 'text' | 'number' | 'boolean' | 'date-text';
  baselineValue: string | null;
}

export interface GoogleSheetsMirrorPendingMutation {
  mutationId: string;
  mutationType: 'append_row' | 'update_cells' | 'clear_cells';
  createdAt: string;
  updatedAt: string;
  targetRow: number;
  writeRanges: string[];
  cells: GoogleSheetsMirrorPendingMutationCell[];
}

export type GoogleSheetsMirrorSyncAuthorityMode =
  | 'live_authoritative'
  | 'mirror_authoritative'
  | 'conflict';

export type GoogleSheetsMirrorWriteSessionStatus =
  | 'idle'
  | 'active'
  | 'verifying'
  | 'committed'
  | 'failed'
  | 'conflict';

export type GoogleSheetsMirrorAuthoritativeSource =
  | 'live_manual'
  | 'mirror_write_contract';

export interface GoogleSheetsMirrorAuthorityState {
  syncAuthorityMode: GoogleSheetsMirrorSyncAuthorityMode;
  activeWriteSessionId: string | null;
  activeWriteScope: string[];
  activeWriteSource: GoogleSheetsMirrorAuthoritativeSource | null;
  writeSessionStatus: GoogleSheetsMirrorWriteSessionStatus;
  lastAuthoritativeSource: GoogleSheetsMirrorAuthoritativeSource | null;
  lastAuthorityConflictReason: string | null;
  updatedAt: string | null;
}

export interface GoogleSheetsMirrorSheet {
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  sheetName: GoogleSheetsMirrorSheetName;
  sheetId: number | null;
  syncedAt: string;
  mirrorMode: 'value-only-sparse';
  discoveryMode: 'column-b-cutoff' | 'used-range-sparse';
  lastDiscoveryRange: string | null;
  headerSnapshot: GoogleSheetsMirrorValueCell[];
  nonEmptyRowCount: number;
  nonEmptyCellCount: number;
  lastDataRow: number;
  valueCells: GoogleSheetsMirrorValueCell[];
  pendingMutations: GoogleSheetsMirrorPendingMutation[];
}

export interface GoogleSheetsMirrorIndexEntry {
  sheetName: GoogleSheetsMirrorSheetName;
  sheetId: number | null;
  fileName: string;
  syncedAt: string;
  discoveryMode: GoogleSheetsMirrorSheet['discoveryMode'];
  lastDiscoveryRange: string | null;
  nonEmptyRowCount: number;
  nonEmptyCellCount: number;
  lastDataRow: number;
}

export interface GoogleSheetsMirrorIndex {
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  syncedAt: string;
  mirrorMode: 'value-only-sparse';
  sheetCount: number;
  mirrorCellCount: number;
  sheets: GoogleSheetsMirrorIndexEntry[];
  authorityState: GoogleSheetsMirrorAuthorityState;
}

export function getGoogleSheetsMirrorRoot(config: AppConfig): string {
  return join(config.runtimeRoot, 'mirror');
}

export function getGoogleSheetsMirrorIndexPath(config: AppConfig): string {
  return join(getGoogleSheetsMirrorRoot(config), 'index.json');
}

export function getGoogleSheetsMirrorSheetPath(
  config: AppConfig,
  sheetName: GoogleSheetsMirrorSheetName,
): string {
  return join(getGoogleSheetsMirrorRoot(config), `${slugifySheetName(sheetName)}.json`);
}

export function buildGoogleSheetsMirrorSheet(
  metadata: GoogleSheetsSpreadsheetMetadata,
  rangeSample: GoogleSheetsRangeSample,
  sheetName: GoogleSheetsMirrorSheetName,
  syncedAt: string,
): GoogleSheetsMirrorSheet {
  const sheetMetadata = metadata.sheets.find((sheet) => sheet.title === sheetName);
  const discoveryMode = sheetName === 'STOK MOTOR' ? 'column-b-cutoff' : 'used-range-sparse';
  const lastDataRow = sheetName === 'STOK MOTOR'
    ? computeStokMotorLastDataRow(rangeSample.rows)
    : computeLastNonEmptyRow(rangeSample.rows);
  const valueCells = buildSparseValueCells(rangeSample.rows, lastDataRow);
  const headerSnapshot = valueCells.filter((cell) => cell.row === 1);
  const nonEmptyRowCount = new Set(valueCells.map((cell) => cell.row)).size;

  return {
    spreadsheetId: metadata.spreadsheetId,
    spreadsheetTitle: metadata.title,
    sheetName,
    sheetId: sheetMetadata?.sheetId ?? null,
    syncedAt,
    mirrorMode: 'value-only-sparse',
    discoveryMode,
    lastDiscoveryRange: rangeSample.returnedRange ?? rangeSample.resolvedRange,
    headerSnapshot,
    nonEmptyRowCount,
    nonEmptyCellCount: valueCells.length,
    lastDataRow,
    valueCells,
    pendingMutations: [],
  };
}

export function buildGoogleSheetsDiscoveryRequestRange(
  sheetName: GoogleSheetsMirrorSheetName,
  columnCount: number | null,
): string {
  const effectiveColumnCount = columnCount && columnCount > 0 ? columnCount : 26;
  return `${sheetName}!A:${toColumnLetters(effectiveColumnCount)}`;
}

export async function persistGoogleSheetsMirror(
  config: AppConfig,
  index: GoogleSheetsMirrorIndex,
  sheets: GoogleSheetsMirrorSheet[],
): Promise<void> {
  const mirrorRoot = getGoogleSheetsMirrorRoot(config);
  await mkdir(mirrorRoot, { recursive: true });

  for (const sheet of sheets) {
    await writeGoogleSheetsMirrorSheet(config, sheet);
  }

  await writeGoogleSheetsMirrorIndex(config, index);
}

export function buildGoogleSheetsMirrorIndex(
  _config: AppConfig,
  metadata: GoogleSheetsSpreadsheetMetadata,
  sheets: GoogleSheetsMirrorSheet[],
  syncedAt: string,
  authorityState?: GoogleSheetsMirrorAuthorityState,
): GoogleSheetsMirrorIndex {
  return {
    spreadsheetId: metadata.spreadsheetId,
    spreadsheetTitle: metadata.title,
    syncedAt,
    mirrorMode: 'value-only-sparse',
    sheetCount: sheets.length,
    mirrorCellCount: sheets.reduce((sum, sheet) => sum + sheet.nonEmptyCellCount, 0),
    sheets: sheets.map((sheet) => ({
      sheetName: sheet.sheetName,
      sheetId: sheet.sheetId,
      fileName: getGoogleSheetsMirrorSheetFileName(sheet.sheetName),
      syncedAt: sheet.syncedAt,
      discoveryMode: sheet.discoveryMode,
      lastDiscoveryRange: sheet.lastDiscoveryRange,
      nonEmptyRowCount: sheet.nonEmptyRowCount,
      nonEmptyCellCount: sheet.nonEmptyCellCount,
      lastDataRow: sheet.lastDataRow,
    })),
    authorityState: normalizeGoogleSheetsMirrorAuthorityState(authorityState ?? {}),
  };
}

export function buildDefaultGoogleSheetsMirrorAuthorityState(
  updatedAt: string | null = null,
): GoogleSheetsMirrorAuthorityState {
  return {
    syncAuthorityMode: 'live_authoritative',
    activeWriteSessionId: null,
    activeWriteScope: [],
    activeWriteSource: null,
    writeSessionStatus: 'idle',
    lastAuthoritativeSource: null,
    lastAuthorityConflictReason: null,
    updatedAt,
  };
}

export function computeStokMotorLastDataRow(rows: string[][]): number {
  let lastDataRow = rows.length > 0 ? 1 : 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const nameCell = row[1] ?? '';
    if (nameCell.trim().length > 0 || hasTrackedStokMotorRowValue(row)) {
      lastDataRow = rowIndex + 1;
    }
  }

  return lastDataRow;
}

export function computeLastNonEmptyRow(rows: string[][]): number {
  let lastDataRow = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (row.some((cell) => cell.trim().length > 0)) {
      lastDataRow = rowIndex + 1;
    }
  }

  return lastDataRow;
}

export function buildSparseValueCells(
  rows: string[][],
  lastDataRow: number,
): GoogleSheetsMirrorValueCell[] {
  const cells: GoogleSheetsMirrorValueCell[] = [];
  const effectiveLastRow = Math.min(lastDataRow, rows.length);

  for (let rowIndex = 0; rowIndex < effectiveLastRow; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const value = row[colIndex] ?? '';
      if (value.trim().length === 0) {
        continue;
      }

      cells.push({
        row: rowIndex + 1,
        col: colIndex + 1,
        a1: toA1(rowIndex + 1, colIndex + 1),
        value,
      });
    }
  }

  return cells;
}

export function toA1(row: number, col: number): string {
  return `${toColumnLetters(col)}${row}`;
}

function toColumnLetters(columnNumber: number): string {
  let value = columnNumber;
  let letters = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }

  return letters;
}

function slugifySheetName(sheetName: GoogleSheetsMirrorSheetName): string {
  return sheetName.toLowerCase().replace(/[^\w]+/gu, '-').replace(/^-+|-+$/gu, '');
}

function getGoogleSheetsMirrorSheetFileName(sheetName: GoogleSheetsMirrorSheetName): string {
  return `${slugifySheetName(sheetName)}.json`;
}

function hasTrackedStokMotorRowValue(row: string[]): boolean {
  return (
    hasNonEmptyRange(row, 1, 10) ||
    hasNonEmptyRange(row, 11, 13)
  );
}

function hasNonEmptyRange(row: string[], startColInclusive: number, endColExclusive: number): boolean {
  for (let colIndex = startColInclusive; colIndex < endColExclusive; colIndex += 1) {
    const value = row[colIndex] ?? '';
    if (value.trim().length > 0) {
      return true;
    }
  }

  return false;
}

export async function readGoogleSheetsMirrorIndex(config: AppConfig): Promise<GoogleSheetsMirrorIndex> {
  const raw = await readFile(getGoogleSheetsMirrorIndexPath(config), 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Google Sheets mirror index must contain an object.');
  }

  const index = parsed as Partial<GoogleSheetsMirrorIndex>;
  if (!index.spreadsheetId || typeof index.spreadsheetId !== 'string') {
    throw new Error('Google Sheets mirror index is missing spreadsheetId.');
  }

  if (!Array.isArray(index.sheets)) {
    throw new Error('Google Sheets mirror index is missing sheets.');
  }

  return {
    spreadsheetId: index.spreadsheetId,
    spreadsheetTitle: typeof index.spreadsheetTitle === 'string' ? index.spreadsheetTitle : null,
    syncedAt: typeof index.syncedAt === 'string' ? index.syncedAt : '',
    mirrorMode: 'value-only-sparse',
    sheetCount: typeof index.sheetCount === 'number' ? index.sheetCount : index.sheets.length,
    mirrorCellCount: typeof index.mirrorCellCount === 'number' ? index.mirrorCellCount : 0,
    sheets: index.sheets.map((sheet) => normalizeMirrorIndexEntry(sheet)),
    authorityState: normalizeGoogleSheetsMirrorAuthorityState(index.authorityState),
  };
}

export async function readGoogleSheetsMirrorSheet(
  config: AppConfig,
  sheetName: GoogleSheetsMirrorSheetName,
): Promise<GoogleSheetsMirrorSheet> {
  const raw = await readFile(getGoogleSheetsMirrorSheetPath(config, sheetName), 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Google Sheets mirror sheet ${sheetName} must contain an object.`);
  }

  return normalizeGoogleSheetsMirrorSheet(parsed as Partial<GoogleSheetsMirrorSheet>, sheetName);
}

export async function writeGoogleSheetsMirrorIndex(
  config: AppConfig,
  index: GoogleSheetsMirrorIndex,
): Promise<void> {
  await mkdir(getGoogleSheetsMirrorRoot(config), { recursive: true });
  await writeFile(getGoogleSheetsMirrorIndexPath(config), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

export async function writeGoogleSheetsMirrorSheet(
  config: AppConfig,
  sheet: GoogleSheetsMirrorSheet,
): Promise<void> {
  await mkdir(getGoogleSheetsMirrorRoot(config), { recursive: true });
  await writeFile(
    getGoogleSheetsMirrorSheetPath(config, sheet.sheetName),
    `${JSON.stringify(sheet, null, 2)}\n`,
    'utf8',
  );
}

export function normalizeGoogleSheetsMirrorSheet(
  sheet: Partial<GoogleSheetsMirrorSheet>,
  expectedSheetName?: GoogleSheetsMirrorSheetName,
): GoogleSheetsMirrorSheet {
  const sheetName = normalizeMirrorSheetName(sheet.sheetName, expectedSheetName);
  const valueCells = Array.isArray(sheet.valueCells)
    ? sheet.valueCells.map((cell) => normalizeValueCell(cell))
    : [];
  const normalizedSheet: GoogleSheetsMirrorSheet = {
    spreadsheetId: typeof sheet.spreadsheetId === 'string' ? sheet.spreadsheetId : '',
    spreadsheetTitle: typeof sheet.spreadsheetTitle === 'string' ? sheet.spreadsheetTitle : null,
    sheetName,
    sheetId: typeof sheet.sheetId === 'number' ? sheet.sheetId : null,
    syncedAt: typeof sheet.syncedAt === 'string' ? sheet.syncedAt : '',
    mirrorMode: 'value-only-sparse',
    discoveryMode:
      sheet.discoveryMode === 'column-b-cutoff' ? 'column-b-cutoff' : 'used-range-sparse',
    lastDiscoveryRange: typeof sheet.lastDiscoveryRange === 'string' ? sheet.lastDiscoveryRange : null,
    headerSnapshot: Array.isArray(sheet.headerSnapshot)
      ? sheet.headerSnapshot.map((cell) => normalizeValueCell(cell)).filter((cell) => cell.row === 1)
      : valueCells.filter((cell) => cell.row === 1),
    nonEmptyRowCount: typeof sheet.nonEmptyRowCount === 'number' ? sheet.nonEmptyRowCount : 0,
    nonEmptyCellCount: typeof sheet.nonEmptyCellCount === 'number' ? sheet.nonEmptyCellCount : valueCells.length,
    lastDataRow: typeof sheet.lastDataRow === 'number' ? sheet.lastDataRow : 0,
    valueCells,
    pendingMutations: Array.isArray(sheet.pendingMutations)
      ? sheet.pendingMutations.map((mutation) => normalizePendingMutation(mutation))
      : [],
  };

  return recalculateGoogleSheetsMirrorSheet(normalizedSheet);
}

export function recalculateGoogleSheetsMirrorSheet(sheet: GoogleSheetsMirrorSheet): GoogleSheetsMirrorSheet {
  const sortedValueCells = [...sheet.valueCells].sort((left, right) =>
    left.row === right.row ? left.col - right.col : left.row - right.row,
  );
  const headerSnapshot = sortedValueCells.filter((cell) => cell.row === 1);
  const nonEmptyRowCount = new Set(sortedValueCells.map((cell) => cell.row)).size;
  const lastDataRow = sheet.sheetName === 'STOK MOTOR'
    ? computeStokMotorLastDataRow(buildRowsFromSparseCells(sortedValueCells))
    : computeLastDataRowFromSparseCells(sortedValueCells);

  return {
    ...sheet,
    headerSnapshot,
    nonEmptyRowCount,
    nonEmptyCellCount: sortedValueCells.length,
    lastDataRow,
    valueCells: sortedValueCells,
    pendingMutations: [...sheet.pendingMutations].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.mutationId.localeCompare(right.mutationId),
    ),
  };
}

export function normalizeGoogleSheetsMirrorAuthorityState(
  state: Partial<GoogleSheetsMirrorAuthorityState> | undefined | null,
): GoogleSheetsMirrorAuthorityState {
  const defaultState = buildDefaultGoogleSheetsMirrorAuthorityState();
  const parsed = state ?? {};

  return {
    syncAuthorityMode:
      parsed.syncAuthorityMode === 'mirror_authoritative' || parsed.syncAuthorityMode === 'conflict'
        ? parsed.syncAuthorityMode
        : defaultState.syncAuthorityMode,
    activeWriteSessionId:
      typeof parsed.activeWriteSessionId === 'string' && parsed.activeWriteSessionId.trim().length > 0
        ? parsed.activeWriteSessionId
        : null,
    activeWriteScope: Array.isArray(parsed.activeWriteScope)
      ? parsed.activeWriteScope.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        )
      : [],
    activeWriteSource:
      parsed.activeWriteSource === 'mirror_write_contract' || parsed.activeWriteSource === 'live_manual'
        ? parsed.activeWriteSource
        : null,
    writeSessionStatus:
      parsed.writeSessionStatus === 'active' ||
      parsed.writeSessionStatus === 'verifying' ||
      parsed.writeSessionStatus === 'committed' ||
      parsed.writeSessionStatus === 'failed' ||
      parsed.writeSessionStatus === 'conflict'
        ? parsed.writeSessionStatus
        : defaultState.writeSessionStatus,
    lastAuthoritativeSource:
      parsed.lastAuthoritativeSource === 'mirror_write_contract' ||
      parsed.lastAuthoritativeSource === 'live_manual'
        ? parsed.lastAuthoritativeSource
        : null,
    lastAuthorityConflictReason:
      typeof parsed.lastAuthorityConflictReason === 'string' && parsed.lastAuthorityConflictReason.trim().length > 0
        ? parsed.lastAuthorityConflictReason
        : null,
    updatedAt:
      typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim().length > 0
        ? parsed.updatedAt
        : null,
  };
}

export function buildGoogleSheetsMirrorAuthorityScope(
  sheets: readonly GoogleSheetsMirrorSheet[],
): string[] {
  const scope = new Set<string>();

  for (const sheet of sheets) {
    for (const mutation of sheet.pendingMutations) {
      for (const writeRange of mutation.writeRanges) {
        scope.add(writeRange);
      }
    }
  }

  return [...scope].sort((left, right) => left.localeCompare(right));
}

export function hasGoogleSheetsMirrorPendingMutations(
  sheets: readonly GoogleSheetsMirrorSheet[],
): boolean {
  return sheets.some((sheet) => sheet.pendingMutations.length > 0);
}

export function readGoogleSheetsMirrorCellValue(
  sheet: GoogleSheetsMirrorSheet,
  row: number,
  col: number,
): string | null {
  const cell = sheet.valueCells.find((entry) => entry.row === row && entry.col === col);
  return cell?.value ?? null;
}

function normalizeMirrorIndexEntry(entry: unknown): GoogleSheetsMirrorIndexEntry {
  const parsed = (entry ?? {}) as Partial<GoogleSheetsMirrorIndexEntry>;
  return {
    sheetName: normalizeMirrorSheetName(parsed.sheetName),
    sheetId: typeof parsed.sheetId === 'number' ? parsed.sheetId : null,
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : '',
    syncedAt: typeof parsed.syncedAt === 'string' ? parsed.syncedAt : '',
    discoveryMode:
      parsed.discoveryMode === 'column-b-cutoff' ? 'column-b-cutoff' : 'used-range-sparse',
    lastDiscoveryRange: typeof parsed.lastDiscoveryRange === 'string' ? parsed.lastDiscoveryRange : null,
    nonEmptyRowCount: typeof parsed.nonEmptyRowCount === 'number' ? parsed.nonEmptyRowCount : 0,
    nonEmptyCellCount: typeof parsed.nonEmptyCellCount === 'number' ? parsed.nonEmptyCellCount : 0,
    lastDataRow: typeof parsed.lastDataRow === 'number' ? parsed.lastDataRow : 0,
  };
}

function normalizeMirrorSheetName(
  sheetName: unknown,
  expectedSheetName?: GoogleSheetsMirrorSheetName,
): GoogleSheetsMirrorSheetName {
  if (sheetName && GOOGLE_SHEETS_MIRROR_SHEET_NAMES.includes(sheetName as GoogleSheetsMirrorSheetName)) {
    return sheetName as GoogleSheetsMirrorSheetName;
  }

  if (expectedSheetName) {
    return expectedSheetName;
  }

  throw new Error('Google Sheets mirror sheetName is invalid.');
}

function normalizeValueCell(cell: unknown): GoogleSheetsMirrorValueCell {
  const parsed = (cell ?? {}) as Partial<GoogleSheetsMirrorValueCell>;
  const row = typeof parsed.row === 'number' ? parsed.row : 0;
  const col = typeof parsed.col === 'number' ? parsed.col : 0;
  return {
    row,
    col,
    a1: typeof parsed.a1 === 'string' && parsed.a1.length > 0 ? parsed.a1 : toA1(row, col),
    value: typeof parsed.value === 'string' ? parsed.value : String(parsed.value ?? ''),
  };
}

function normalizePendingMutation(mutation: unknown): GoogleSheetsMirrorPendingMutation {
  const parsed = (mutation ?? {}) as Partial<GoogleSheetsMirrorPendingMutation>;
  if (typeof parsed.mutationId !== 'string' || parsed.mutationId.length === 0) {
    throw new Error('Google Sheets mirror pending mutation is missing mutationId.');
  }

  return {
    mutationId: parsed.mutationId,
    mutationType:
      parsed.mutationType === 'update_cells' || parsed.mutationType === 'clear_cells'
        ? parsed.mutationType
        : 'append_row',
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    targetRow: typeof parsed.targetRow === 'number' ? parsed.targetRow : 0,
    writeRanges: Array.isArray(parsed.writeRanges)
      ? parsed.writeRanges.filter((range): range is string => typeof range === 'string')
      : [],
    cells: Array.isArray(parsed.cells)
      ? parsed.cells.map((cell) => normalizePendingMutationCell(cell))
      : [],
  };
}

function normalizePendingMutationCell(cell: unknown): GoogleSheetsMirrorPendingMutationCell {
  const parsed = (cell ?? {}) as Partial<GoogleSheetsMirrorPendingMutationCell>;
  const row = typeof parsed.row === 'number' ? parsed.row : 0;
  const col = typeof parsed.col === 'number' ? parsed.col : 0;
  const value = parsed.value;

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new Error('Google Sheets mirror pending mutation cell value is invalid.');
  }

  return {
    row,
    col,
    a1: typeof parsed.a1 === 'string' && parsed.a1.length > 0 ? parsed.a1 : toA1(row, col),
    value,
    valueKind:
      parsed.valueKind === 'number' ||
      parsed.valueKind === 'boolean' ||
      parsed.valueKind === 'date-text'
        ? parsed.valueKind
        : 'text',
    baselineValue:
      typeof parsed.baselineValue === 'string'
        ? parsed.baselineValue
        : parsed.baselineValue === null
          ? null
          : null,
  };
}

function buildRowsFromSparseCells(cells: GoogleSheetsMirrorValueCell[]): string[][] {
  const rows = new Map<number, string[]>();

  for (const cell of cells) {
    const row = rows.get(cell.row) ?? [];
    row[cell.col - 1] = cell.value;
    rows.set(cell.row, row);
  }

  const lastRow = cells.reduce((max, cell) => Math.max(max, cell.row), 0);
  return Array.from({ length: lastRow }, (_, index) => rows.get(index + 1) ?? []);
}

function computeLastDataRowFromSparseCells(cells: GoogleSheetsMirrorValueCell[]): number {
  return cells.reduce((max, cell) => Math.max(max, cell.row), 0);
}
