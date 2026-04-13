import type { AppConfig } from '../config/app-config.js';
import {
  readGoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorSheetName,
} from '../google/google-sheets-mirror.js';

export type SpreadsheetReadSheetName = GoogleSheetsMirrorSheetName;

export type SpreadsheetReadFilterOperator =
  | 'contains'
  | 'equals'
  | 'starts_with';

export interface SpreadsheetReadFilter {
  field: string;
  operator?: SpreadsheetReadFilterOperator;
  value: string;
}

export interface SpreadsheetReadRequest {
  sheet: SpreadsheetReadSheetName;
  filters?: SpreadsheetReadFilter[];
  includeSold?: boolean;
  limit?: number | null;
}

export interface SpreadsheetReadResponse {
  spreadsheetName: string | null;
  sheetName: SpreadsheetReadSheetName;
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
  filteredRowCount: number;
  error: string | null;
}

export interface SpreadsheetReadService {
  readData(request: SpreadsheetReadRequest): Promise<SpreadsheetReadResponse>;
}

const STOK_MOTOR_HEADERS = [
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
];

const EMPTY_CELL_VALUE = '-';

export function createSpreadsheetReadService(config: AppConfig): SpreadsheetReadService {
  return {
    async readData(request) {
      try {
        const sheet = await readGoogleSheetsMirrorSheet(config, request.sheet);
        return buildSpreadsheetReadResponse(sheet, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          spreadsheetName: null,
          sheetName: request.sheet,
          headers: [],
          rows: [],
          rowCount: 0,
          filteredRowCount: 0,
          error: message.length > 0 ? 'Data spreadsheet belum tersedia.' : 'Data spreadsheet belum tersedia.',
        };
      }
    },
  };
}

function buildSpreadsheetReadResponse(
  sheet: GoogleSheetsMirrorSheet,
  request: SpreadsheetReadRequest,
): SpreadsheetReadResponse {
  const headers = resolveHeaders(sheet);
  const rows = buildRows(sheet, headers);
  const filteredRows = applyFilters(sheet.sheetName, rows, request);
  const limitedRows = applyLimit(filteredRows, request.limit ?? null);

  return {
    spreadsheetName: sheet.spreadsheetTitle ?? 'Arjun Motor Project',
    sheetName: sheet.sheetName,
    headers,
    rows: limitedRows,
    rowCount: rows.length,
    filteredRowCount: filteredRows.length,
    error: null,
  };
}

function resolveHeaders(sheet: GoogleSheetsMirrorSheet): string[] {
  if (sheet.sheetName === 'STOK MOTOR') {
    return [...STOK_MOTOR_HEADERS];
  }

  const headerCells = [...sheet.headerSnapshot].sort((left, right) => left.col - right.col);
  const headers = headerCells
    .map((cell) => cell.value.trim())
    .filter((value) => value.length > 0);

  return headers.length > 0 ? headers : STOK_MOTOR_HEADERS.slice(0, 1);
}

function buildRows(sheet: GoogleSheetsMirrorSheet, headers: string[]): Array<Record<string, string>> {
  const headerIndex = buildHeaderIndex(sheet, headers);
  const rowsByIndex = new Map<number, Map<number, string>>();

  for (const cell of sheet.valueCells) {
    if (cell.row <= 1) {
      continue;
    }
    const rowMap = rowsByIndex.get(cell.row) ?? new Map<number, string>();
    rowMap.set(cell.col, cell.value);
    rowsByIndex.set(cell.row, rowMap);
  }

  const rows: Array<Record<string, string>> = [];
  for (let row = 2; row <= sheet.lastDataRow; row += 1) {
    const rowValues = rowsByIndex.get(row);
    if (!rowValues || rowValues.size === 0) {
      continue;
    }

    const record: Record<string, string> = {};
    for (const header of headers) {
      const colIndex = headerIndex.get(header);
      const raw = colIndex ? rowValues.get(colIndex) : '';
      record[header] = normalizeCellValue(raw);
    }

    if (sheet.sheetName === 'STOK MOTOR') {
      record.STATUS = normalizeStokMotorStatus(record.STATUS);
      record.NO = normalizeCellValue(record.NO);
    }

    rows.push(record);
  }

  return rows;
}

function buildHeaderIndex(
  sheet: GoogleSheetsMirrorSheet,
  headers: string[],
): Map<string, number> {
  const headerCells = [...sheet.headerSnapshot].sort((left, right) => left.col - right.col);
  const index = new Map<string, number>();

  for (const cell of headerCells) {
    const header = cell.value.trim().toUpperCase();
    if (!header) {
      continue;
    }
    index.set(header, cell.col);
  }

  if (sheet.sheetName === 'STOK MOTOR') {
    if (!index.has('NO')) {
      index.set('NO', 1);
    }
    if (!index.has('STATUS')) {
      index.set('STATUS', 13);
    }
  }

  const normalizedHeaders = headers.map((header) => header.trim().toUpperCase());
  const mappedIndex = new Map<string, number>();
  normalizedHeaders.forEach((header) => {
    const col = index.get(header);
    if (col) {
      mappedIndex.set(header, col);
    }
  });

  return mappedIndex;
}

function applyFilters(
  sheetName: GoogleSheetsMirrorSheetName,
  rows: Array<Record<string, string>>,
  request: SpreadsheetReadRequest,
): Array<Record<string, string>> {
  const includeSold = request.includeSold === true;
  const filters = Array.isArray(request.filters) ? request.filters : [];

  return rows.filter((row) => {
    if (sheetName === 'STOK MOTOR' && !includeSold) {
      if (normalizeStokMotorStatus(row.STATUS) === 'TERJUAL') {
        return false;
      }
    }

    return filters.every((filter) => matchesFilter(row, filter));
  });
}

function applyLimit(
  rows: Array<Record<string, string>>,
  limit: number | null,
): Array<Record<string, string>> {
  if (!limit || !Number.isFinite(limit) || limit <= 0) {
    return rows;
  }

  return rows.slice(0, Math.floor(limit));
}

function matchesFilter(
  row: Record<string, string>,
  filter: SpreadsheetReadFilter,
): boolean {
  if (!filter || typeof filter.value !== 'string') {
    return true;
  }

  const fieldName = String(filter.field ?? '').trim().toUpperCase();
  if (!fieldName) {
    return true;
  }

  const rawValue = row[fieldName] ?? '';
  const left = normalizeComparable(rawValue);
  const right = normalizeComparable(filter.value);
  const operator = filter.operator ?? 'contains';

  if (operator === 'equals') {
    return left === right;
  }

  if (operator === 'starts_with') {
    return left.startsWith(right);
  }

  return left.includes(right);
}

function normalizeCellValue(value: string | undefined): string {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : EMPTY_CELL_VALUE;
}

function normalizeComparable(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeStokMotorStatus(rawValue: string | undefined): 'READY' | 'TERJUAL' {
  const normalized = String(rawValue ?? '').trim().toLowerCase();
  if (normalized === 'true' || normalized === 'terjual') {
    return 'TERJUAL';
  }
  return 'READY';
}
