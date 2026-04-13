import { readFile } from 'node:fs/promises';

import { google } from 'googleapis';

import type { AppConfig } from '../config/app-config.js';
import { inspectGoogleSheetsConfig } from '../config/google-sheets-config.js';

export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const GOOGLE_SHEETS_READWRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export const GOOGLE_SHEETS_SMOKE_TEST_RANGES = [
  'TOTAL ASET!A1:B20',
  'STOK MOTOR!A1:M20',
  'PENGELUARAN HARIAN!A1:F40',
] as const;

export type GoogleSheetsValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
export type GoogleSheetsWriteInputValue = string | number | boolean;

export interface GoogleSheetsClientInspection {
  ready: boolean;
  spreadsheetId: string | null;
  serviceAccountEmail: string | null;
  serviceAccountKeyPath: string | null;
  projectId: string | null;
  error: string | null;
}

export interface GoogleSheetsSpreadsheetMetadata {
  spreadsheetId: string;
  title: string | null;
  locale: string | null;
  timeZone: string | null;
  sheets: Array<{
    sheetId: number | null;
    title: string;
    index: number | null;
    rowCount: number | null;
    columnCount: number | null;
  }>;
}

export interface GoogleSheetsRangeSample {
  requestedRange: string;
  resolvedRange: string;
  returnedRange: string | null;
  rowCount: number;
  rows: string[][];
}

export interface GoogleSheetsTypedRangeSample {
  requestedRange: string;
  resolvedRange: string;
  returnedRange: string | null;
  rowCount: number;
  rows: Array<Array<string | number | boolean>>;
}

export interface GoogleSheetsBatchWriteRequest {
  range: string;
  values: GoogleSheetsWriteInputValue[][];
}

export interface GoogleSheetsClearResult {
  requestedRange: string;
  resolvedRange: string;
  clearedRange: string | null;
}

export interface GoogleSheetsWriteResult {
  requestedRange: string;
  resolvedRange: string;
  updatedRange: string | null;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

export interface GoogleSheetsValidationCopyRequest {
  sourceRange: string;
  targetRange: string;
}

export interface GoogleSheetsValidationCopyResult {
  sourceRange: string;
  resolvedSourceRange: string;
  targetRange: string;
  resolvedTargetRange: string;
}

export interface GoogleSheetsGridValidationRule {
  conditionType: string | null;
  values: string[];
  strict: boolean;
  showCustomUi: boolean;
}

export interface GoogleSheetsGridCellSample {
  formattedValue: string | null;
  formula: string | null;
  rawValue: string | number | boolean | null;
  dataValidation: GoogleSheetsGridValidationRule | null;
}

export interface GoogleSheetsGridRangeSample {
  requestedRange: string;
  resolvedRange: string;
  rowCount: number;
  rows: GoogleSheetsGridCellSample[][];
}

export interface GoogleSheetsAuthResult {
  serviceAccountEmail: string;
  spreadsheetId: string;
  accessTokenPresent: boolean;
}

export interface GoogleSheetsReadClient {
  inspect(): GoogleSheetsClientInspection;
  authenticate(): Promise<GoogleSheetsAuthResult>;
  readSpreadsheetMetadata(): Promise<GoogleSheetsSpreadsheetMetadata>;
  readRanges(ranges: readonly string[]): Promise<GoogleSheetsRangeSample[]>;
  readRangesWithRender(
    ranges: readonly string[],
    valueRenderOption: GoogleSheetsValueRenderOption,
  ): Promise<GoogleSheetsTypedRangeSample[]>;
  readGridRanges(ranges: readonly string[]): Promise<GoogleSheetsGridRangeSample[]>;
  readSheetValues(sheetName: string): Promise<GoogleSheetsRangeSample>;
}

export interface GoogleSheetsWriteClient extends GoogleSheetsReadClient {
  writeRanges(
    requests: readonly GoogleSheetsBatchWriteRequest[],
    valueInputOption?: 'RAW' | 'USER_ENTERED',
  ): Promise<GoogleSheetsWriteResult[]>;
  clearRanges(ranges: readonly string[]): Promise<GoogleSheetsClearResult[]>;
  copyDataValidation(
    requests: readonly GoogleSheetsValidationCopyRequest[],
  ): Promise<GoogleSheetsValidationCopyResult[]>;
}

interface GoogleServiceAccountKeyFile {
  type?: unknown;
  project_id?: unknown;
  client_email?: unknown;
  private_key?: unknown;
}

interface GoogleSheetsClientBase {
  inspection: GoogleSheetsClientInspection;
  authenticate(): Promise<GoogleSheetsAuthResult>;
  readSpreadsheetMetadata(): Promise<GoogleSheetsSpreadsheetMetadata>;
  readRangesWithRender(
    ranges: readonly string[],
    valueRenderOption: GoogleSheetsValueRenderOption,
  ): Promise<GoogleSheetsTypedRangeSample[]>;
  readGridRanges(ranges: readonly string[]): Promise<GoogleSheetsGridRangeSample[]>;
  readRanges(ranges: readonly string[]): Promise<GoogleSheetsRangeSample[]>;
  readSheetValues(sheetName: string): Promise<GoogleSheetsRangeSample>;
  writeRanges?(
    requests: readonly GoogleSheetsBatchWriteRequest[],
    valueInputOption?: 'RAW' | 'USER_ENTERED',
  ): Promise<GoogleSheetsWriteResult[]>;
  clearRanges?(ranges: readonly string[]): Promise<GoogleSheetsClearResult[]>;
  copyDataValidation?(
    requests: readonly GoogleSheetsValidationCopyRequest[],
  ): Promise<GoogleSheetsValidationCopyResult[]>;
}

export async function inspectGoogleSheetsClientConfig(
  config: AppConfig,
): Promise<GoogleSheetsClientInspection> {
  const baseInspection = await inspectGoogleSheetsConfig(config);
  if (!baseInspection.ready) {
    return {
      ready: false,
      spreadsheetId: baseInspection.spreadsheetId,
      serviceAccountEmail: baseInspection.serviceAccountEmail,
      serviceAccountKeyPath: baseInspection.serviceAccountKeyPath,
      projectId: null,
      error: baseInspection.error,
    };
  }

  try {
    const keyFile = await readGoogleServiceAccountKeyFile(baseInspection.serviceAccountKeyPath!);
    if (keyFile.type !== 'service_account') {
      return {
        ready: false,
        spreadsheetId: baseInspection.spreadsheetId,
        serviceAccountEmail: baseInspection.serviceAccountEmail,
        serviceAccountKeyPath: baseInspection.serviceAccountKeyPath,
        projectId: keyFile.projectId,
        error: 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not a service account JSON key.',
      };
    }

    if (keyFile.clientEmail !== baseInspection.serviceAccountEmail) {
      return {
        ready: false,
        spreadsheetId: baseInspection.spreadsheetId,
        serviceAccountEmail: baseInspection.serviceAccountEmail,
        serviceAccountKeyPath: baseInspection.serviceAccountKeyPath,
        projectId: keyFile.projectId,
        error:
          'GOOGLE_SERVICE_ACCOUNT_EMAIL does not match client_email in GOOGLE_SERVICE_ACCOUNT_KEY_PATH.',
      };
    }

    if (!keyFile.privateKeyPresent) {
      return {
        ready: false,
        spreadsheetId: baseInspection.spreadsheetId,
        serviceAccountEmail: baseInspection.serviceAccountEmail,
        serviceAccountKeyPath: baseInspection.serviceAccountKeyPath,
        projectId: keyFile.projectId,
        error: 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH does not contain a private_key.',
      };
    }

    return {
      ready: true,
      spreadsheetId: baseInspection.spreadsheetId,
      serviceAccountEmail: baseInspection.serviceAccountEmail,
      serviceAccountKeyPath: baseInspection.serviceAccountKeyPath,
      projectId: keyFile.projectId,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      spreadsheetId: baseInspection.spreadsheetId,
      serviceAccountEmail: baseInspection.serviceAccountEmail,
      serviceAccountKeyPath: baseInspection.serviceAccountKeyPath,
      projectId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createGoogleSheetsReadClient(
  config: AppConfig,
): Promise<GoogleSheetsReadClient> {
  const client = await createGoogleSheetsClientBase(config, [GOOGLE_SHEETS_READONLY_SCOPE]);
  return {
    inspect() {
      return client.inspection;
    },
    authenticate: client.authenticate,
    readSpreadsheetMetadata: client.readSpreadsheetMetadata,
    readRanges: client.readRanges,
    readRangesWithRender: client.readRangesWithRender,
    readGridRanges: client.readGridRanges,
    readSheetValues: client.readSheetValues,
  };
}

export async function createGoogleSheetsWriteClient(
  config: AppConfig,
): Promise<GoogleSheetsWriteClient> {
  const client = await createGoogleSheetsClientBase(config, [GOOGLE_SHEETS_READWRITE_SCOPE]);
  if (!client.writeRanges) {
    throw new Error('Google Sheets write client is not available.');
  }
  if (!client.clearRanges) {
    throw new Error('Google Sheets clear client is not available.');
  }
  if (!client.copyDataValidation) {
    throw new Error('Google Sheets validation copy client is not available.');
  }

  return {
    inspect() {
      return client.inspection;
    },
    authenticate: client.authenticate,
    readSpreadsheetMetadata: client.readSpreadsheetMetadata,
    readRanges: client.readRanges,
    readRangesWithRender: client.readRangesWithRender,
    readGridRanges: client.readGridRanges,
    readSheetValues: client.readSheetValues,
    writeRanges: client.writeRanges,
    clearRanges: client.clearRanges,
    copyDataValidation: client.copyDataValidation,
  };
}

export function resolveGoogleSheetsReadRange(requestedRange: string): string {
  const normalized = requestedRange.trim();
  const separatorIndex = normalized.indexOf('!');
  if (separatorIndex < 0) {
    return normalized;
  }

  const rawSheetName = normalized.slice(0, separatorIndex).trim().replace(/^'+|'+$/gu, '');
  const rawCellRange = normalized.slice(separatorIndex + 1).trim();
  const escapedSheetName = rawSheetName.replace(/'/gu, "''");
  return `'${escapedSheetName}'!${rawCellRange}`;
}

async function createGoogleSheetsClientBase(
  config: AppConfig,
  scopes: readonly string[],
): Promise<GoogleSheetsClientBase> {
  const inspection = await inspectGoogleSheetsClientConfig(config);
  if (
    !inspection.ready ||
    !inspection.spreadsheetId ||
    !inspection.serviceAccountEmail ||
    !inspection.serviceAccountKeyPath
  ) {
    throw new Error(inspection.error ?? 'Google Sheets client is not ready.');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: inspection.serviceAccountKeyPath,
    scopes: [...scopes],
  });

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  async function authenticate(): Promise<GoogleSheetsAuthResult> {
    const authClient = await auth.getClient();
    const accessToken = await authClient.getAccessToken();

    return {
      serviceAccountEmail: inspection.serviceAccountEmail!,
      spreadsheetId: inspection.spreadsheetId!,
      accessTokenPresent: hasAccessToken(accessToken),
    };
  }

  async function readSpreadsheetMetadata(): Promise<GoogleSheetsSpreadsheetMetadata> {
    const response = await sheets.spreadsheets.get({
      spreadsheetId: inspection.spreadsheetId!,
      fields:
        'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))',
    });

    const spreadsheet = response.data;
    return {
      spreadsheetId: spreadsheet.spreadsheetId ?? inspection.spreadsheetId!,
      title: spreadsheet.properties?.title ?? null,
      locale: spreadsheet.properties?.locale ?? null,
      timeZone: spreadsheet.properties?.timeZone ?? null,
      sheets: (spreadsheet.sheets ?? []).map((sheet) => ({
        sheetId: sheet.properties?.sheetId ?? null,
        title: sheet.properties?.title ?? '(untitled-sheet)',
        index: sheet.properties?.index ?? null,
        rowCount: sheet.properties?.gridProperties?.rowCount ?? null,
        columnCount: sheet.properties?.gridProperties?.columnCount ?? null,
      })),
    };
  }

  async function readRangesWithRender(
    ranges: readonly string[],
    valueRenderOption: GoogleSheetsValueRenderOption,
  ): Promise<GoogleSheetsTypedRangeSample[]> {
    const resolvedRanges = ranges.map((range) => resolveGoogleSheetsReadRange(range));
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: inspection.spreadsheetId!,
      ranges: resolvedRanges,
      majorDimension: 'ROWS',
      valueRenderOption,
    });

    const valueRanges = response.data.valueRanges ?? [];
    return resolvedRanges.map((resolvedRange, index) => {
      const valueRange = valueRanges[index];
      const rows = normalizeTypedValueRows(valueRange?.values);
      return {
        requestedRange: ranges[index] ?? resolvedRange,
        resolvedRange,
        returnedRange: valueRange?.range ?? null,
        rowCount: rows.length,
        rows,
      };
    });
  }

  async function readRanges(ranges: readonly string[]): Promise<GoogleSheetsRangeSample[]> {
    const typedRanges = await readRangesWithRender(ranges, 'FORMATTED_VALUE');
    return typedRanges.map((range) => ({
      ...range,
      rows: range.rows.map((row) => row.map((cell) => (typeof cell === 'string' ? cell : String(cell)))),
    }));
  }

  async function readGridRanges(ranges: readonly string[]): Promise<GoogleSheetsGridRangeSample[]> {
    const resolvedRanges = ranges.map((range) => resolveGoogleSheetsReadRange(range));
    const response = await sheets.spreadsheets.get({
      spreadsheetId: inspection.spreadsheetId!,
      ranges: resolvedRanges,
      includeGridData: true,
      fields:
        'sheets(data(rowData(values(formattedValue,userEnteredValue(formulaValue),effectiveValue(stringValue,numberValue,boolValue),dataValidation(condition(type,values(userEnteredValue)),strict,showCustomUi)))))',
    });

    const dataRanges = (response.data.sheets ?? []).flatMap((sheet) => sheet.data ?? []);
    return resolvedRanges.map((resolvedRange, index) => ({
      requestedRange: ranges[index] ?? resolvedRange,
      resolvedRange,
      rowCount: normalizeGridRows(dataRanges[index]?.rowData).length,
      rows: normalizeGridRows(dataRanges[index]?.rowData),
    }));
  }

  async function readSheetValues(sheetName: string): Promise<GoogleSheetsRangeSample> {
    const [result] = await readRanges([sheetName]);
    if (!result) {
      throw new Error(`No Google Sheets values response was returned for sheet ${sheetName}.`);
    }
    return result;
  }

  async function writeRanges(
    requests: readonly GoogleSheetsBatchWriteRequest[],
    valueInputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED',
  ): Promise<GoogleSheetsWriteResult[]> {
    if (requests.length === 0) {
      return [];
    }

    const resolvedRequests = requests.map((request) => ({
      requestedRange: request.range,
      resolvedRange: resolveGoogleSheetsReadRange(request.range),
      values: request.values.map((row) => row.map((cell) => normalizeWriteCellValue(cell))),
    }));

    const response = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: inspection.spreadsheetId!,
      requestBody: {
        valueInputOption,
        data: resolvedRequests.map((request) => ({
          range: request.resolvedRange,
          majorDimension: 'ROWS',
          values: request.values,
        })),
      },
    });

    const responses = response.data.responses ?? [];
    return resolvedRequests.map((request, index) => {
      const entry = responses[index];
      return {
        requestedRange: request.requestedRange,
        resolvedRange: request.resolvedRange,
        updatedRange: entry?.updatedRange ?? null,
        updatedRows: entry?.updatedRows ?? 0,
        updatedColumns: entry?.updatedColumns ?? 0,
        updatedCells: entry?.updatedCells ?? 0,
      };
    });
  }

  async function clearRanges(ranges: readonly string[]): Promise<GoogleSheetsClearResult[]> {
    if (ranges.length === 0) {
      return [];
    }

    const resolvedRanges = ranges.map((range) => resolveGoogleSheetsReadRange(range));
    const response = await sheets.spreadsheets.values.batchClear({
      spreadsheetId: inspection.spreadsheetId!,
      requestBody: {
        ranges: resolvedRanges,
      },
    });

    const clearedRanges = response.data.clearedRanges ?? [];
    return resolvedRanges.map((resolvedRange, index) => ({
      requestedRange: ranges[index] ?? resolvedRange,
      resolvedRange,
      clearedRange: clearedRanges[index] ?? null,
    }));
  }

  async function copyDataValidation(
    requests: readonly GoogleSheetsValidationCopyRequest[],
  ): Promise<GoogleSheetsValidationCopyResult[]> {
    if (requests.length === 0) {
      return [];
    }

    const metadata = await readSpreadsheetMetadata();
    const sheetIdByName = new Map(
      metadata.sheets
        .filter((sheet) => typeof sheet.sheetId === 'number')
        .map((sheet) => [sheet.title, sheet.sheetId as number]),
    );

    const resolvedRequests = requests.map((request) => {
      const resolvedSourceRange = resolveGoogleSheetsReadRange(request.sourceRange);
      const resolvedTargetRange = resolveGoogleSheetsReadRange(request.targetRange);
      const source = parseGoogleSheetsA1Range(resolvedSourceRange);
      const target = parseGoogleSheetsA1Range(resolvedTargetRange);

      if (source.sheetName !== target.sheetName) {
        throw new Error('Google Sheets validation copy must stay inside the same sheet.');
      }

      const sourceHeight = source.endRow - source.startRow + 1;
      const sourceWidth = source.endCol - source.startCol + 1;
      const targetHeight = target.endRow - target.startRow + 1;
      const targetWidth = target.endCol - target.startCol + 1;
      if (sourceHeight !== targetHeight || sourceWidth !== targetWidth) {
        throw new Error('Google Sheets validation copy requires source and target ranges with matching size.');
      }

      const sheetId = sheetIdByName.get(source.sheetName);
      if (typeof sheetId !== 'number') {
        throw new Error(`Google Sheets sheet ${source.sheetName} could not be resolved for validation copy.`);
      }

      return {
        sourceRange: request.sourceRange,
        resolvedSourceRange,
        targetRange: request.targetRange,
        resolvedTargetRange,
        source,
        target,
        sheetId,
      };
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: inspection.spreadsheetId!,
      requestBody: {
        requests: resolvedRequests.map((request) => ({
          copyPaste: {
            source: {
              sheetId: request.sheetId,
              startRowIndex: request.source.startRow - 1,
              endRowIndex: request.source.endRow,
              startColumnIndex: request.source.startCol - 1,
              endColumnIndex: request.source.endCol,
            },
            destination: {
              sheetId: request.sheetId,
              startRowIndex: request.target.startRow - 1,
              endRowIndex: request.target.endRow,
              startColumnIndex: request.target.startCol - 1,
              endColumnIndex: request.target.endCol,
            },
            pasteType: 'PASTE_DATA_VALIDATION',
            pasteOrientation: 'NORMAL',
          },
        })),
      },
    });

    return resolvedRequests.map((request) => ({
      sourceRange: request.sourceRange,
      resolvedSourceRange: request.resolvedSourceRange,
      targetRange: request.targetRange,
      resolvedTargetRange: request.resolvedTargetRange,
    }));
  }

  return {
    inspection,
    authenticate,
    readSpreadsheetMetadata,
    readRangesWithRender,
    readGridRanges,
    readRanges,
    readSheetValues,
    writeRanges,
    clearRanges,
    copyDataValidation,
  };
}

async function readGoogleServiceAccountKeyFile(
  keyPath: string,
): Promise<{
  type: string | null;
  projectId: string | null;
  clientEmail: string | null;
  privateKeyPresent: boolean;
}> {
  const raw = await readFile(keyPath, 'utf8');
  const parsed = JSON.parse(raw) as GoogleServiceAccountKeyFile;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH must contain a JSON object.');
  }

  return {
    type: typeof parsed.type === 'string' ? parsed.type : null,
    projectId: typeof parsed.project_id === 'string' ? parsed.project_id : null,
    clientEmail: typeof parsed.client_email === 'string' ? parsed.client_email : null,
    privateKeyPresent: typeof parsed.private_key === 'string' && parsed.private_key.trim().length > 0,
  };
}

function hasAccessToken(
  value:
    | string
    | null
    | undefined
    | {
        token?: string | null;
      },
): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (value && typeof value === 'object' && typeof value.token === 'string') {
    return value.token.trim().length > 0;
  }

  return false;
}

function normalizeTypedValueRows(values: unknown): Array<Array<string | number | boolean>> {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((row) => {
    if (!Array.isArray(row)) {
      return [];
    }

    return row.map((cell) => {
      if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') {
        return cell;
      }

      if (cell === null || cell === undefined) {
        return '';
      }

      return String(cell);
    });
  });
}

function normalizeGridRows(values: unknown): GoogleSheetsGridCellSample[][] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((row) => {
    const cells = (row as { values?: unknown }).values;
    if (!Array.isArray(cells)) {
      return [];
    }

    return cells.map((cell) => {
      const parsed = (cell ?? {}) as {
        formattedValue?: unknown;
        userEnteredValue?: { formulaValue?: unknown } | null;
        effectiveValue?: {
          stringValue?: unknown;
          numberValue?: unknown;
          boolValue?: unknown;
        } | null;
        dataValidation?: {
          condition?: {
            type?: unknown;
            values?: Array<{ userEnteredValue?: unknown }>;
          } | null;
          strict?: unknown;
          showCustomUi?: unknown;
        } | null;
      };

      return {
        formattedValue: typeof parsed.formattedValue === 'string' ? parsed.formattedValue : null,
        formula:
          typeof parsed.userEnteredValue?.formulaValue === 'string'
            ? parsed.userEnteredValue.formulaValue
            : null,
        rawValue: normalizeGridRawValue(parsed.effectiveValue),
        dataValidation: normalizeGridValidation(parsed.dataValidation),
      };
    });
  });
}

function normalizeGridRawValue(
  value:
    | {
        stringValue?: unknown;
        numberValue?: unknown;
        boolValue?: unknown;
      }
    | null
    | undefined,
): string | number | boolean | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (typeof value.stringValue === 'string') {
    return value.stringValue;
  }

  if (typeof value.numberValue === 'number') {
    return value.numberValue;
  }

  if (typeof value.boolValue === 'boolean') {
    return value.boolValue;
  }

  return null;
}

function normalizeGridValidation(
  rule:
    | {
        condition?: {
          type?: unknown;
          values?: Array<{ userEnteredValue?: unknown }>;
        } | null;
        strict?: unknown;
        showCustomUi?: unknown;
      }
    | null
    | undefined,
): GoogleSheetsGridValidationRule | null {
  if (!rule || typeof rule !== 'object') {
    return null;
  }

  const values = Array.isArray(rule.condition?.values)
    ? rule.condition.values
        .map((entry) => (typeof entry?.userEnteredValue === 'string' ? entry.userEnteredValue : null))
        .filter((entry): entry is string => entry !== null)
    : [];

  return {
    conditionType: typeof rule.condition?.type === 'string' ? rule.condition.type : null,
    values,
    strict: rule.strict === true,
    showCustomUi: rule.showCustomUi === true,
  };
}

function normalizeWriteCellValue(cell: GoogleSheetsWriteInputValue): GoogleSheetsWriteInputValue {
  if (typeof cell === 'string') {
    return cell;
  }

  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) {
      throw new Error('Google Sheets write values must not contain non-finite numbers.');
    }
    return cell;
  }

  return cell;
}

function parseGoogleSheetsA1Range(range: string): {
  sheetName: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
} {
  const normalized = range.trim();
  const separatorIndex = normalized.lastIndexOf('!');
  if (separatorIndex < 0) {
    throw new Error(`Google Sheets A1 range must include a sheet name: ${range}`);
  }

  const rawSheetName = normalized.slice(0, separatorIndex).trim().replace(/^'+|'+$/gu, '').replace(/''/gu, "'");
  const rawRange = normalized.slice(separatorIndex + 1).trim();
  const refs = rawRange.split(':');
  const startRefRaw = refs[0];
  const endRefRaw = refs[1] ?? refs[0];
  if (!startRefRaw || !endRefRaw) {
    throw new Error(`Google Sheets A1 range is invalid: ${range}`);
  }

  const startRef = parseGoogleSheetsA1Cell(startRefRaw);
  const endRef = parseGoogleSheetsA1Cell(endRefRaw);

  return {
    sheetName: rawSheetName,
    startRow: Math.min(startRef.row, endRef.row),
    endRow: Math.max(startRef.row, endRef.row),
    startCol: Math.min(startRef.col, endRef.col),
    endCol: Math.max(startRef.col, endRef.col),
  };
}

function parseGoogleSheetsA1Cell(cellRef: string): {
  row: number;
  col: number;
} {
  const match = cellRef.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/u);
  if (!match) {
    throw new Error(`Google Sheets A1 cell reference is invalid: ${cellRef}`);
  }

  const letters = match[1];
  const rowText = match[2];
  if (!letters || !rowText) {
    throw new Error(`Google Sheets A1 cell reference is invalid: ${cellRef}`);
  }
  return {
    row: Number(rowText),
    col: fromColumnLetters(letters),
  };
}

function fromColumnLetters(letters: string): number {
  let column = 0;
  for (const char of letters) {
    column = (column * 26) + (char.charCodeAt(0) - 64);
  }
  return column;
}
