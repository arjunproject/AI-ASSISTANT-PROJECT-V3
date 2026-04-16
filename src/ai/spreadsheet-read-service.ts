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
  | 'is_empty'
  | 'starts_with';

export interface SpreadsheetReadFilter {
  field: string;
  operator: SpreadsheetReadFilterOperator;
  value: string;
}

export interface SpreadsheetReadRequest {
  sheet: SpreadsheetReadSheetName;
  query?: string | null;
  filters?: SpreadsheetReadFilter[] | null;
  includeSold?: boolean | null;
  incompleteOnly?: boolean | null;
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
const STOK_MOTOR_MANDATORY_FIELDS = [
  'NAMA MOTOR',
  'TAHUN',
  'PLAT',
  'SURAT-SURAT',
  'TAHUN PLAT',
  'PAJAK',
  'HARGA JUAL',
  'HARGA BELI',
];

interface ColumnDescriptor {
  col: number;
  label: string;
  baseLabel: string;
  searchableFieldNames: string[];
}

interface SearchableRow {
  record: Record<string, string>;
  cells: Array<{
    label: string;
    baseLabel: string;
    value: string;
    searchableFieldNames: string[];
  }>;
}

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
    rows: limitedRows.map((row) => row.record),
    rowCount: rows.length,
    filteredRowCount: filteredRows.length,
    error: null,
  };
}

function resolveHeaders(sheet: GoogleSheetsMirrorSheet): string[] {
  if (sheet.sheetName === 'TOTAL ASET') {
    const extraHeaders = buildColumnDescriptors(sheet)
      .filter((descriptor) => descriptor.col > 2)
      .map((descriptor) => descriptor.label);
    return ['ITEM', 'NILAI', ...extraHeaders];
  }

  return buildColumnDescriptors(sheet).map((descriptor) => descriptor.label);
}

function buildRows(
  sheet: GoogleSheetsMirrorSheet,
  headers: string[],
): SearchableRow[] {
  if (sheet.sheetName === 'TOTAL ASET') {
    return buildTotalAsetRows(sheet);
  }

  const descriptors = buildColumnDescriptors(sheet, headers);
  const rowsByIndex = new Map<number, Map<number, string>>();

  for (const cell of sheet.valueCells) {
    if (cell.row <= 1) {
      continue;
    }
    const rowMap = rowsByIndex.get(cell.row) ?? new Map<number, string>();
    rowMap.set(cell.col, cell.value);
    rowsByIndex.set(cell.row, rowMap);
  }

  const rows: SearchableRow[] = [];
  for (let row = 2; row <= sheet.lastDataRow; row += 1) {
    const rowValues = rowsByIndex.get(row);
    if (!rowValues || rowValues.size === 0) {
      continue;
    }

    const record: Record<string, string> = {};
    const cells: SearchableRow['cells'] = [];
    for (const descriptor of descriptors) {
      const raw = rowValues.get(descriptor.col);
      const value = normalizeCellValue(raw);
      record[descriptor.label] = value;
      cells.push({
        label: descriptor.label,
        baseLabel: descriptor.baseLabel,
        value,
        searchableFieldNames: descriptor.searchableFieldNames,
      });
    }

    if (sheet.sheetName === 'STOK MOTOR') {
      record.STATUS = normalizeStokMotorStatus(record.STATUS);
      record.NO = normalizeCellValue(record.NO);
      for (const cell of cells) {
        if (normalizeFieldName(cell.baseLabel) === 'STATUS') {
          cell.value = record.STATUS;
        }
        if (normalizeFieldName(cell.baseLabel) === 'NO') {
          cell.value = record.NO;
        }
      }
    }

    if (!shouldIncludeRow(sheet.sheetName, cells)) {
      continue;
    }

    rows.push({
      record,
      cells,
    });
  }

  return rows;
}

function buildColumnDescriptors(
  sheet: GoogleSheetsMirrorSheet,
  preferredLabels?: string[],
): ColumnDescriptor[] {
  if (sheet.sheetName === 'STOK MOTOR') {
    return STOK_MOTOR_HEADERS.map((label, index) => buildColumnDescriptor(index + 1, label, label));
  }

  const observedColumns = new Set<number>();
  for (const headerCell of sheet.headerSnapshot) {
    observedColumns.add(headerCell.col);
  }
  for (const cell of sheet.valueCells) {
    if (cell.row <= 1) {
      continue;
    }
    observedColumns.add(cell.col);
  }

  const sortedColumns = [...observedColumns].sort((left, right) => left - right);
  const headerByColumn = new Map<number, string>();
  for (const cell of sheet.headerSnapshot) {
    const header = cell.value.trim();
    if (header.length > 0) {
      headerByColumn.set(cell.col, header);
    }
  }

  const preferredByIndex = new Map<number, string>();
  if (Array.isArray(preferredLabels)) {
    preferredLabels.forEach((label, index) => {
      preferredByIndex.set(index + 1, label);
    });
  }

  const baseLabels = sortedColumns.map((col) => {
    const preferred = preferredByIndex.get(col);
    if (preferred && preferred.trim().length > 0) {
      return preferred.trim();
    }
    return headerByColumn.get(col) ?? `KOLOM ${toColumnLetter(col)}`;
  });

  const duplicateCounts = new Map<string, number>();
  for (const baseLabel of baseLabels) {
    const normalized = normalizeFieldName(baseLabel);
    duplicateCounts.set(normalized, (duplicateCounts.get(normalized) ?? 0) + 1);
  }

  return sortedColumns.map((col, index) => {
    const baseLabel = baseLabels[index]!;
    const duplicateCount = duplicateCounts.get(normalizeFieldName(baseLabel)) ?? 0;
    const label =
      duplicateCount > 1 ? `${baseLabel} [${toColumnLetter(col)}]` : baseLabel;
    return buildColumnDescriptor(col, label, baseLabel);
  });
}

function buildColumnDescriptor(col: number, label: string, baseLabel: string): ColumnDescriptor {
  const normalizedFieldNames = dedupeStrings([
    normalizeFieldName(label),
    normalizeFieldName(baseLabel),
    normalizeFieldName(`KOLOM ${toColumnLetter(col)}`),
  ]).filter((value) => value.length > 0);

  return {
    col,
    label,
    baseLabel,
    searchableFieldNames: normalizedFieldNames,
  };
}

function buildTotalAsetRows(sheet: GoogleSheetsMirrorSheet): SearchableRow[] {
  const rowsByIndex = new Map<number, Map<number, string>>();

  for (const cell of sheet.valueCells) {
    const rowMap = rowsByIndex.get(cell.row) ?? new Map<number, string>();
    rowMap.set(cell.col, cell.value);
    rowsByIndex.set(cell.row, rowMap);
  }

  const extraColumns = buildColumnDescriptors(sheet)
    .filter((descriptor) => descriptor.col > 2);
  const rows: SearchableRow[] = [];

  for (let row = 1; row <= sheet.lastDataRow; row += 1) {
    const rowValues = rowsByIndex.get(row);
    if (!rowValues || rowValues.size === 0) {
      continue;
    }

    const item = normalizeCellValue(rowValues.get(1));
    const value = normalizeCellValue(rowValues.get(2));
    if (item === EMPTY_CELL_VALUE && value === EMPTY_CELL_VALUE) {
      continue;
    }

    const record: Record<string, string> = {
      ITEM: item,
      NILAI: value,
    };
    const cells: SearchableRow['cells'] = [
      {
        label: 'ITEM',
        baseLabel: 'ITEM',
        value: item,
        searchableFieldNames: ['ITEM', 'LABEL', 'KOLOM A'],
      },
      {
        label: 'NILAI',
        baseLabel: 'NILAI',
        value,
        searchableFieldNames: ['NILAI', 'VALUE', 'KOLOM B'],
      },
    ];

    for (const descriptor of extraColumns) {
      const cellValue = normalizeCellValue(rowValues.get(descriptor.col));
      record[descriptor.label] = cellValue;
      cells.push({
        label: descriptor.label,
        baseLabel: descriptor.baseLabel,
        value: cellValue,
        searchableFieldNames: descriptor.searchableFieldNames,
      });
    }

    rows.push({
      record,
      cells,
    });
  }

  return rows;
}

function applyFilters(
  sheetName: GoogleSheetsMirrorSheetName,
  rows: SearchableRow[],
  request: SpreadsheetReadRequest,
): SearchableRow[] {
  const includeSold = request.includeSold === true;
  const filters = Array.isArray(request.filters) ? request.filters : [];
  const query = normalizeComparable(request.query ?? '');

  return rows.filter((row) => {
    if (sheetName === 'STOK MOTOR' && !includeSold) {
      if (normalizeStokMotorStatus(row.record.STATUS) === 'TERJUAL') {
        return false;
      }
    }

    if (sheetName === 'STOK MOTOR' && request.incompleteOnly === true && !isIncompleteStokMotorRow(row)) {
      return false;
    }

    if (query.length > 0 && !matchesQuery(row, query)) {
      return false;
    }

    return matchesFilters(row, filters);
  });
}

function applyLimit(
  rows: SearchableRow[],
  limit: number | null,
): SearchableRow[] {
  if (!limit || !Number.isFinite(limit) || limit <= 0) {
    return rows;
  }

  return rows.slice(0, Math.floor(limit));
}

function isIncompleteStokMotorRow(row: SearchableRow): boolean {
  return STOK_MOTOR_MANDATORY_FIELDS.some((fieldName) => {
    const normalizedFieldName = normalizeFieldName(fieldName);
    const cell = row.cells.find((candidate) =>
      candidate.searchableFieldNames.includes(normalizedFieldName),
    );
    if (!cell) {
      return true;
    }

    const value = normalizeComparable(cell.value);
    return value.length === 0 || value === EMPTY_CELL_VALUE;
  });
}

function matchesFilter(
  row: SearchableRow,
  filter: SpreadsheetReadFilter,
): boolean {
  if (!filter || typeof filter.value !== 'string') {
    return true;
  }

  const fieldName = String(filter.field ?? '').trim().toUpperCase();
  if (!fieldName) {
    return true;
  }

  const normalizedFieldName = normalizeFieldName(fieldName);
  const right = normalizeComparable(filter.value);
  const operator = filter.operator ?? 'contains';
  const matchingCells =
    normalizedFieldName === '*' || normalizedFieldName === 'ANY'
      ? row.cells
      : row.cells.filter((cell) => cell.searchableFieldNames.includes(normalizedFieldName));

  if (matchingCells.length === 0) {
    return false;
  }

  return matchingCells.some((cell) => matchesValue(normalizeComparable(cell.value), right, operator));
}

function matchesFilters(row: SearchableRow, filters: SpreadsheetReadFilter[]): boolean {
  if (filters.length === 0) {
    return true;
  }

  const emptyFilters = filters.filter((filter) => filter.operator === 'is_empty');
  const regularFilters = filters.filter((filter) => filter.operator !== 'is_empty');

  if (!regularFilters.every((filter) => matchesFilter(row, filter))) {
    return false;
  }

  if (emptyFilters.length === 0) {
    return true;
  }

  return emptyFilters.some((filter) => matchesFilter(row, filter));
}

function matchesQuery(row: SearchableRow, query: string): boolean {
  return row.cells.some((cell) => {
    if (cell.value !== EMPTY_CELL_VALUE && normalizeComparable(cell.value).includes(query)) {
      return true;
    }

    return normalizeComparable(cell.label).includes(query);
  });
}

function matchesValue(
  left: string,
  right: string,
  operator: SpreadsheetReadFilterOperator,
): boolean {
  if (operator === 'is_empty') {
    const trimmed = String(left ?? '').trim();
    return trimmed.length === 0 || trimmed === EMPTY_CELL_VALUE;
  }

  if (operator === 'equals') {
    return left === right;
  }

  if (operator === 'starts_with') {
    return left.startsWith(right);
  }

  return left.includes(right);
}

function shouldIncludeRow(
  sheetName: GoogleSheetsMirrorSheetName,
  cells: SearchableRow['cells'],
): boolean {
  if (sheetName === 'STOK MOTOR') {
    return cells.some((cell) => {
      const fieldName = normalizeFieldName(cell.baseLabel);
      if (fieldName === 'NO' || fieldName === 'STATUS') {
        return false;
      }

      return cell.value !== EMPTY_CELL_VALUE;
    });
  }

  return cells.some((cell) => cell.value !== EMPTY_CELL_VALUE);
}

function normalizeCellValue(value: string | undefined): string {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : EMPTY_CELL_VALUE;
}

function normalizeComparable(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeFieldName(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeStokMotorStatus(rawValue: string | undefined): 'READY' | 'TERJUAL' {
  const normalized = String(rawValue ?? '').trim().toLowerCase();
  if (normalized === 'true' || normalized === 'terjual') {
    return 'TERJUAL';
  }
  return 'READY';
}

function toColumnLetter(col: number): string {
  let current = Math.max(1, Math.floor(col));
  let result = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
