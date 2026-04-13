import type { Logger } from '../core/logger.js';
import type { AppConfig } from '../config/app-config.js';
import {
  createGoogleSheetsWriteClient,
  type GoogleSheetsBatchWriteRequest,
  type GoogleSheetsClearResult,
  type GoogleSheetsGridRangeSample,
  type GoogleSheetsTypedRangeSample,
  type GoogleSheetsWriteInputValue,
  type GoogleSheetsWriteResult,
} from './google-sheets-client.js';
import {
  GOOGLE_SHEETS_MIRROR_SHEET_NAMES,
  buildDefaultGoogleSheetsMirrorAuthorityState,
  buildGoogleSheetsMirrorAuthorityScope,
  hasGoogleSheetsMirrorPendingMutations,
  normalizeGoogleSheetsMirrorAuthorityState,
  readGoogleSheetsMirrorCellValue,
  readGoogleSheetsMirrorIndex,
  readGoogleSheetsMirrorSheet,
  recalculateGoogleSheetsMirrorSheet,
  toA1,
  writeGoogleSheetsMirrorIndex,
  writeGoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorIndex,
  type GoogleSheetsMirrorIndexEntry,
  type GoogleSheetsMirrorAuthorityState,
  type GoogleSheetsMirrorAuthoritativeSource,
  type GoogleSheetsMirrorMutationValue,
  type GoogleSheetsMirrorPendingMutation,
  type GoogleSheetsMirrorPendingMutationCell,
  type GoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorSheetName,
  type GoogleSheetsMirrorValueCell,
} from './google-sheets-mirror.js';

export type GoogleSheetsMirrorWritableSheetName = 'STOK MOTOR' | 'PENGELUARAN HARIAN';

export interface GoogleSheetsMirrorAppendRowInput {
  sheetName: GoogleSheetsMirrorSheetName;
  cells: Array<{
    col: number;
    value: string | number | boolean;
  }>;
  createdAt?: string;
}

export interface GoogleSheetsMirrorUpdateCellsInput {
  sheetName: GoogleSheetsMirrorSheetName;
  targetRow: number;
  cells: Array<{
    col: number;
    value: string | number | boolean;
  }>;
  createdAt?: string;
}

export interface GoogleSheetsMirrorConfirmSoldInput {
  targetRow: number;
  salePrice: string | number;
  soldAt: string;
  createdAt?: string;
}

export interface GoogleSheetsMirrorDeleteRowInput {
  sheetName: GoogleSheetsMirrorWritableSheetName;
  targetRow: number;
  createdAt?: string;
}

export interface GoogleSheetsMirrorMutationResult {
  mutationId: string;
  mutationType: GoogleSheetsMirrorPendingMutation['mutationType'];
  sheetName: GoogleSheetsMirrorSheetName;
  targetRow: number;
  cellCount: number;
  pendingMutationCount: number;
}

export interface GoogleSheetsMirrorApplyResult {
  mutationId: string;
  mutationType: GoogleSheetsMirrorPendingMutation['mutationType'];
  sheetName: GoogleSheetsMirrorSheetName;
  targetRow: number;
  writeMethod: 'batchUpdate' | 'batchClear';
  writeRanges: string[];
  writeResults: GoogleSheetsWriteResult[];
  clearResults: GoogleSheetsClearResult[];
  verifiedCells: GoogleSheetsMirrorValueCell[];
  sacredSentinelRanges: string[];
  verifiedAt: string;
}

export interface GoogleSheetsMirrorBatchMutationRef {
  sheetName: GoogleSheetsMirrorSheetName;
  mutationId: string;
}

export interface GoogleSheetsMirrorBatchApplyResult {
  mutationCount: number;
  sheetNames: GoogleSheetsMirrorSheetName[];
  writeMethod: 'batchUpdate' | 'batchClear' | 'mixed';
  writeRangeCount: number;
  writeResults: GoogleSheetsWriteResult[];
  clearResults: GoogleSheetsClearResult[];
  sacredSentinelRanges: string[];
  verifiedAt: string;
  results: GoogleSheetsMirrorApplyResult[];
}

export interface GoogleSheetsMirrorWriteEligibility {
  allowed: boolean;
  reason: string | null;
}

export interface GoogleSheetsMirrorValidationSnapshot {
  requestedRange: string;
  rows: Array<
    Array<{
      conditionType: string | null;
      values: string[];
      strict: boolean;
      showCustomUi: boolean;
      formattedValue: string | null;
      formula: string | null;
    }>
  >;
}

export interface GoogleSheetsMirrorValidationRecoveryResult {
  recovered: boolean;
  targetRanges: string[];
  sourceRanges: string[];
}

type GoogleSheetsMirrorValueKind = GoogleSheetsMirrorPendingMutationCell['valueKind'];

interface PlannedMirrorWriteRange {
  range: string;
  startCol: number;
  cells: GoogleSheetsMirrorPendingMutationCell[];
  values: GoogleSheetsWriteInputValue[][];
}

interface LoadedMirrorMutationContext {
  sheet: GoogleSheetsMirrorSheet;
  mutation: GoogleSheetsMirrorPendingMutation;
  plannedWriteRanges: PlannedMirrorWriteRange[];
  sacredSentinelRanges: string[];
  writeMethod: 'batchUpdate' | 'batchClear';
}

export function inspectGoogleSheetsMirrorCellEligibility(
  sheetName: GoogleSheetsMirrorSheetName,
  row: number,
  col: number,
): GoogleSheetsMirrorWriteEligibility {
  if (sheetName === 'TOTAL ASET') {
    return {
      allowed: false,
      reason: 'TOTAL ASET is full read only.',
    };
  }

  if (row <= 0 || col <= 0) {
    return {
      allowed: false,
      reason: 'Mirror write coordinates must be positive.',
    };
  }

  if (sheetName === 'STOK MOTOR') {
    if (row === 1) {
      return {
        allowed: false,
        reason: 'STOK MOTOR header row is sacred and read only.',
      };
    }

    if (col === 1) {
      return {
        allowed: false,
        reason: 'STOK MOTOR column A is sacred and read only.',
      };
    }

    if (col === 11) {
      return {
        allowed: false,
        reason: 'STOK MOTOR column K is sacred and read only.',
      };
    }

    return {
      allowed: true,
      reason: null,
    };
  }

  if (sheetName === 'PENGELUARAN HARIAN' && row === 1) {
    return {
      allowed: false,
      reason: 'PENGELUARAN HARIAN header row is sacred and read only.',
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

export async function createGoogleSheetsMirrorAppendRowMutation(
  config: AppConfig,
  input: GoogleSheetsMirrorAppendRowInput,
  logger?: Logger,
): Promise<GoogleSheetsMirrorMutationResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const sheet = await readGoogleSheetsMirrorSheet(config, input.sheetName);
  assertWritableSheet(sheet.sheetName);
  const targetRow = resolveMirrorAppendTargetRow(sheet);
  const normalizedCells = normalizeWriteCells(sheet.sheetName, targetRow, input.cells, {
    allowEmptyText: false,
  });

  if (
    sheet.sheetName === 'STOK MOTOR' &&
    !normalizedCells.some((cell) => cell.col === 2 && String(cell.value).trim().length > 0)
  ) {
    throw new Error('STOK MOTOR append rows must include column B / NAMA MOTOR.');
  }

  return persistMirrorMutation(config, sheet, {
    mutationType: 'append_row',
    createdAt,
    targetRow,
    cells: normalizedCells,
  }, logger);
}

export async function createGoogleSheetsMirrorUpdateCellsMutation(
  config: AppConfig,
  input: GoogleSheetsMirrorUpdateCellsInput,
  logger?: Logger,
): Promise<GoogleSheetsMirrorMutationResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const sheet = await readGoogleSheetsMirrorSheet(config, input.sheetName);
  assertWritableSheet(sheet.sheetName);
  assertExistingWritableRow(sheet, input.targetRow);
  const normalizedCells = normalizeWriteCells(sheet.sheetName, input.targetRow, input.cells, {
    allowEmptyText: false,
  });

  return persistMirrorMutation(config, sheet, {
    mutationType: 'update_cells',
    createdAt,
    targetRow: input.targetRow,
    cells: normalizedCells,
  }, logger);
}

export async function createGoogleSheetsMirrorConfirmSoldMutation(
  config: AppConfig,
  input: GoogleSheetsMirrorConfirmSoldInput,
  logger?: Logger,
): Promise<GoogleSheetsMirrorMutationResult> {
  const soldAt = input.soldAt.trim();
  if (soldAt.length === 0) {
    throw new Error('STOK MOTOR confirm sold requires a sold date.');
  }

  return createGoogleSheetsMirrorUpdateCellsMutation(
    config,
    {
      sheetName: 'STOK MOTOR',
      targetRow: input.targetRow,
      createdAt: input.createdAt,
      cells: [
        {
          col: 9,
          value: input.salePrice,
        },
        {
          col: 10,
          value: soldAt,
        },
        {
          col: 13,
          value: true,
        },
      ],
    },
    logger,
  );
}

export async function createGoogleSheetsMirrorDeleteRowMutation(
  config: AppConfig,
  input: GoogleSheetsMirrorDeleteRowInput,
  logger?: Logger,
): Promise<GoogleSheetsMirrorMutationResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const sheet = await readGoogleSheetsMirrorSheet(config, input.sheetName);
  assertWritableSheet(sheet.sheetName);
  assertExistingWritableRow(sheet, input.targetRow);

  const cells = resolveDeleteCells(sheet.sheetName, input.targetRow);
  return persistMirrorMutation(config, sheet, {
    mutationType: 'update_cells',
    createdAt,
    targetRow: input.targetRow,
    cells,
  }, logger);
}

export async function recoverGoogleSheetsMirrorValidationFromNeighbor(
  config: AppConfig,
  targetRow: number,
  logger?: Logger,
): Promise<GoogleSheetsMirrorValidationRecoveryResult> {
  const client = await createGoogleSheetsWriteClient(config);
  const sourceRow = targetRow + 1;
  const sourceRanges = buildStokMotorValidationRanges(sourceRow);
  const targetRanges = buildStokMotorValidationRanges(targetRow);
  const beforeSnapshot = await readGoogleSheetsMirrorValidationSnapshot(config, targetRanges);

  const missingIndexes = beforeSnapshot
    .map((entry, index) => ({
      index,
      missing: !entry.rows[0]?.[0]?.conditionType,
    }))
    .filter((entry) => entry.missing)
    .map((entry) => entry.index);

  if (missingIndexes.length === 0) {
    return {
      recovered: false,
      targetRanges,
      sourceRanges,
    };
  }

  const sourceSnapshot = await readGoogleSheetsMirrorValidationSnapshot(config, sourceRanges);
  for (const index of missingIndexes) {
    if (!sourceSnapshot[index]?.rows[0]?.[0]?.conditionType) {
      throw new Error(`STOK MOTOR validation source is missing at ${sourceRanges[index]}.`);
    }
  }

  logger?.info('mirror.validation_recovery_started', {
    spreadsheetId: config.googleSheetsSpreadsheetId,
    sheetName: 'STOK MOTOR',
    targetRow,
    sourceRow,
    sourceRanges: missingIndexes.map((index) => sourceRanges[index]),
    targetRanges: missingIndexes.map((index) => targetRanges[index]),
  });

  await client.copyDataValidation(
    missingIndexes.map((index) => ({
      sourceRange: sourceRanges[index]!,
      targetRange: targetRanges[index]!,
    })),
  );

  const afterSnapshot = await readGoogleSheetsMirrorValidationSnapshot(config, targetRanges);
  for (const index of missingIndexes) {
    if (!afterSnapshot[index]?.rows[0]?.[0]?.conditionType) {
      throw new Error(`STOK MOTOR validation recovery did not restore ${targetRanges[index]}.`);
    }
  }

  logger?.info('mirror.validation_recovered', {
    spreadsheetId: config.googleSheetsSpreadsheetId,
    sheetName: 'STOK MOTOR',
    targetRow,
    sourceRow,
    sourceRanges: missingIndexes.map((index) => sourceRanges[index]),
    targetRanges: missingIndexes.map((index) => targetRanges[index]),
  });

  return {
    recovered: true,
    targetRanges: missingIndexes.map((index) => targetRanges[index]!),
    sourceRanges: missingIndexes.map((index) => sourceRanges[index]!),
  };
}

export async function applyGoogleSheetsMirrorMutation(
  config: AppConfig,
  sheetName: GoogleSheetsMirrorSheetName,
  mutationId: string,
  logger?: Logger,
): Promise<GoogleSheetsMirrorApplyResult> {
  const batchResult = await applyGoogleSheetsMirrorMutationBatch(
    config,
    [
      {
        sheetName,
        mutationId,
      },
    ],
    logger,
  );
  const result = batchResult.results[0];
  if (!result) {
    throw new Error(`Mirror pending mutation ${mutationId} was not applied for ${sheetName}.`);
  }
  return result;
}

export async function applyGoogleSheetsMirrorMutationBatch(
  config: AppConfig,
  items: readonly GoogleSheetsMirrorBatchMutationRef[],
  logger?: Logger,
): Promise<GoogleSheetsMirrorBatchApplyResult> {
  if (items.length === 0) {
    throw new Error('Mirror batch apply requires at least one mutation.');
  }

  const client = await createGoogleSheetsWriteClient(config);
  const index = await readGoogleSheetsMirrorIndex(config);
  const seenMutationRefs = new Set<string>();
  const sheetCache = new Map<GoogleSheetsMirrorSheetName, GoogleSheetsMirrorSheet>();
  const contexts: LoadedMirrorMutationContext[] = [];

  for (const item of items) {
    const key = `${item.sheetName}:${item.mutationId}`;
    if (seenMutationRefs.has(key)) {
      throw new Error(`Mirror batch apply contains a duplicate mutation reference: ${key}.`);
    }
    seenMutationRefs.add(key);

    let sheet = sheetCache.get(item.sheetName);
    if (!sheet) {
      sheet = await readGoogleSheetsMirrorSheet(config, item.sheetName);
      sheetCache.set(item.sheetName, sheet);
    }

    const mutation = sheet.pendingMutations.find((entry) => entry.mutationId === item.mutationId);
    if (!mutation) {
      throw new Error(`Mirror pending mutation ${item.mutationId} was not found for ${item.sheetName}.`);
    }

    let plannedWriteRanges: PlannedMirrorWriteRange[];
    try {
      plannedWriteRanges = planMirrorWriteRanges(sheet.sheetName, mutation.targetRow, mutation.cells);
    } catch (error) {
      logger?.warn('mirror.apply_blocked', {
        spreadsheetId: sheet.spreadsheetId,
        sheetName: sheet.sheetName,
        mutationId: item.mutationId,
        targetRow: mutation.targetRow,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    contexts.push({
      sheet,
      mutation,
      plannedWriteRanges,
      sacredSentinelRanges: buildSacredSentinelRanges(sheet.sheetName, mutation.targetRow),
      writeMethod: mutation.mutationType === 'clear_cells' ? 'batchClear' : 'batchUpdate',
    });
  }

  const uniqueSheetNames = [...new Set(contexts.map((context) => context.sheet.sheetName))];
  const allSheets = await readAllGoogleSheetsMirrorSheets(config, Object.fromEntries(
    [...sheetCache.entries()].map(([sheetName, sheet]) => [sheetName, sheet]),
  ) as Partial<Record<GoogleSheetsMirrorSheetName, GoogleSheetsMirrorSheet>>);
  const currentAuthorityState = normalizeGoogleSheetsMirrorAuthorityState(index.authorityState);
  assertAuthorityStateAllowsApply(currentAuthorityState, allSheets, contexts);
  const plannedWriteRanges = contexts.flatMap((context) => context.plannedWriteRanges);
  const uniqueSacredSentinelRanges = [...new Set(contexts.flatMap((context) => context.sacredSentinelRanges))];
  const sacredBefore = uniqueSacredSentinelRanges.length > 0
    ? await client.readRangesWithRender(uniqueSacredSentinelRanges, 'FORMULA')
    : [];
  const batchWriteMethod = resolveMirrorBatchWriteMethod(contexts);
  const authorityVerifyingAt = new Date().toISOString();
  const verifyingAuthorityState = buildMirrorAuthorityStateForPendingSheets(
    allSheets,
    currentAuthorityState,
    authorityVerifyingAt,
    {
      status: 'verifying',
      mode: 'mirror_authoritative',
      activeWriteSource: 'mirror_write_contract',
      lastAuthoritativeSource: currentAuthorityState.lastAuthoritativeSource,
      conflictReason: null,
    },
  );

  await writeGoogleSheetsMirrorIndex(config, {
    ...index,
    authorityState: verifyingAuthorityState,
  });

  logger?.info('mirror.authority_session_updated', {
    spreadsheetId: index.spreadsheetId,
    syncAuthorityMode: verifyingAuthorityState.syncAuthorityMode,
    writeSessionStatus: verifyingAuthorityState.writeSessionStatus,
    activeWriteSessionId: verifyingAuthorityState.activeWriteSessionId,
    activeWriteScope: verifyingAuthorityState.activeWriteScope,
  });

  logger?.info('mirror.apply_started', {
    spreadsheetId: index.spreadsheetId,
    mutationCount: contexts.length,
    sheetNames: uniqueSheetNames,
    mutationIds: contexts.map((context) => context.mutation.mutationId),
    writeRangeCount: plannedWriteRanges.length,
    writeMethod: batchWriteMethod,
  });

  const writeRequests = contexts
    .filter((context) => context.writeMethod === 'batchUpdate')
    .flatMap((context) =>
      context.plannedWriteRanges.map<GoogleSheetsBatchWriteRequest>((range) => ({
        range: range.range,
        values: range.values,
      })),
    );
  const clearRanges = contexts
    .filter((context) => context.writeMethod === 'batchClear')
    .flatMap((context) => context.plannedWriteRanges.map((range) => range.range));

  let writeResults: GoogleSheetsWriteResult[] = [];
  let clearResults: GoogleSheetsClearResult[] = [];

  try {
    logger?.info('mirror.apply_requested', {
      spreadsheetId: index.spreadsheetId,
      mutationCount: contexts.length,
      sheetNames: uniqueSheetNames,
      mutationIds: contexts.map((context) => context.mutation.mutationId),
      writeRanges: plannedWriteRanges.map((range) => range.range),
      writeMethod: batchWriteMethod,
    });

    if (clearRanges.length > 0) {
      logger?.info('mirror.delete_started', {
        spreadsheetId: index.spreadsheetId,
        mutationCount: contexts.filter((context) => context.writeMethod === 'batchClear').length,
        writeRanges: clearRanges,
      });
      clearResults = await client.clearRanges(clearRanges);
      logger?.info('mirror.delete_completed', {
        spreadsheetId: index.spreadsheetId,
        mutationCount: contexts.filter((context) => context.writeMethod === 'batchClear').length,
        clearRangeCount: clearResults.length,
      });
    }

    if (writeRequests.length > 0) {
      writeResults = await client.writeRanges(writeRequests, 'USER_ENTERED');
    }
  } catch (error) {
    const failedAuthorityAt = new Date().toISOString();
    const failedAuthorityState = buildMirrorAuthorityStateForPendingSheets(
      allSheets,
      verifyingAuthorityState,
      failedAuthorityAt,
      {
        status: 'failed',
        mode: 'mirror_authoritative',
        activeWriteSource: 'mirror_write_contract',
        lastAuthoritativeSource: currentAuthorityState.lastAuthoritativeSource,
        conflictReason: null,
      },
    );
    await writeGoogleSheetsMirrorIndex(config, {
      ...index,
      authorityState: failedAuthorityState,
    });
    logger?.error('mirror.authority_session_failed', {
      spreadsheetId: index.spreadsheetId,
      syncAuthorityMode: failedAuthorityState.syncAuthorityMode,
      writeSessionStatus: failedAuthorityState.writeSessionStatus,
      activeWriteSessionId: failedAuthorityState.activeWriteSessionId,
      message: error instanceof Error ? error.message : String(error),
    });
    if (clearRanges.length > 0) {
      logger?.error('mirror.delete_failed', {
        spreadsheetId: index.spreadsheetId,
        mutationCount: contexts.filter((context) => context.writeMethod === 'batchClear').length,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    logger?.error('mirror.apply_failed', {
      spreadsheetId: index.spreadsheetId,
      mutationCount: contexts.length,
      sheetNames: uniqueSheetNames,
      mutationIds: contexts.map((context) => context.mutation.mutationId),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  logger?.info('mirror.verify_started', {
    spreadsheetId: index.spreadsheetId,
    mutationCount: contexts.length,
    sheetNames: uniqueSheetNames,
    mutationIds: contexts.map((context) => context.mutation.mutationId),
    verifyRangeCount: plannedWriteRanges.length,
  });

  try {
    const verificationRanges = plannedWriteRanges.map((range) => range.range);
    const formattedRanges = verificationRanges.length > 0
      ? await client.readRanges(verificationRanges)
      : [];
    const rawRanges = verificationRanges.length > 0
      ? await client.readRangesWithRender(verificationRanges, 'UNFORMATTED_VALUE')
      : [];
    const sacredAfter = uniqueSacredSentinelRanges.length > 0
      ? await client.readRangesWithRender(uniqueSacredSentinelRanges, 'FORMULA')
      : [];
    assertSacredSentinelsStable(sacredBefore, sacredAfter);

    const verifiedAt = new Date().toISOString();
    const updatedSheets = new Map<GoogleSheetsMirrorSheetName, GoogleSheetsMirrorSheet>(
      uniqueSheetNames.map((sheetName) => [sheetName, sheetCache.get(sheetName)!]),
    );
    const results: GoogleSheetsMirrorApplyResult[] = [];
    let writeResultIndex = 0;
    let clearResultIndex = 0;
    let rangeIndex = 0;

    for (const context of contexts) {
      const rangeCount = context.plannedWriteRanges.length;
      const formattedSlice = formattedRanges.slice(rangeIndex, rangeIndex + rangeCount);
      const rawSlice = rawRanges.slice(rangeIndex, rangeIndex + rangeCount);
      const verifiedCells = context.mutation.mutationType === 'clear_cells'
        ? verifyMirrorClearCells(context.plannedWriteRanges, formattedSlice)
        : verifyMirrorMutationCells(context.plannedWriteRanges, formattedSlice, rawSlice);
      const currentSheet = updatedSheets.get(context.sheet.sheetName);
      if (!currentSheet) {
        throw new Error(`Mirror sheet cache is missing ${context.sheet.sheetName} during batch apply.`);
      }

      const nextValueCells = context.mutation.mutationType === 'clear_cells'
        ? removeMirrorValueCells(currentSheet.valueCells, context.mutation.cells)
        : upsertMirrorValueCells(
            currentSheet.valueCells,
            verifiedCells.map((cell) => ({
              row: cell.row,
              col: cell.col,
              a1: cell.a1,
              value: cell.value,
              valueKind: inferMirrorValueKind(currentSheet.sheetName, cell.col),
            })),
          );
      const updatedSheet = recalculateGoogleSheetsMirrorSheet({
        ...currentSheet,
        syncedAt: verifiedAt,
        valueCells: nextValueCells,
        pendingMutations: currentSheet.pendingMutations.filter(
          (entry) => entry.mutationId !== context.mutation.mutationId,
        ),
      });
      updatedSheets.set(updatedSheet.sheetName, updatedSheet);

      const currentWriteResults = context.writeMethod === 'batchUpdate'
        ? writeResults.slice(writeResultIndex, writeResultIndex + rangeCount)
        : [];
      const currentClearResults = context.writeMethod === 'batchClear'
        ? clearResults.slice(clearResultIndex, clearResultIndex + rangeCount)
        : [];
      if (context.writeMethod === 'batchUpdate') {
        writeResultIndex += rangeCount;
      } else {
        clearResultIndex += rangeCount;
      }

      results.push({
        mutationId: context.mutation.mutationId,
        mutationType: context.mutation.mutationType,
        sheetName: context.sheet.sheetName,
        targetRow: context.mutation.targetRow,
        writeMethod: context.writeMethod,
        writeRanges: context.plannedWriteRanges.map((range) => range.range),
        writeResults: currentWriteResults,
        clearResults: currentClearResults,
        verifiedCells,
        sacredSentinelRanges: context.sacredSentinelRanges,
        verifiedAt,
      });
      rangeIndex += rangeCount;
    }

    const updatedAllSheets = allSheets.map((sheet) => updatedSheets.get(sheet.sheetName) ?? sheet);
    const finalAuthorityState = buildMirrorAuthorityStateForPendingSheets(
      updatedAllSheets,
      verifyingAuthorityState,
      verifiedAt,
      hasGoogleSheetsMirrorPendingMutations(updatedAllSheets)
        ? {
            status: 'active',
            mode: 'mirror_authoritative',
            activeWriteSource: 'mirror_write_contract',
            lastAuthoritativeSource: verifyingAuthorityState.lastAuthoritativeSource,
            conflictReason: null,
          }
        : {
            status: 'committed',
            mode: 'live_authoritative',
            activeWriteSource: null,
            lastAuthoritativeSource: 'mirror_write_contract',
            conflictReason: null,
          },
    );
    let updatedIndex: GoogleSheetsMirrorIndex = {
      ...index,
      authorityState: finalAuthorityState,
    };
    for (const sheetName of uniqueSheetNames) {
      const updatedSheet = updatedSheets.get(sheetName);
      if (!updatedSheet) {
        throw new Error(`Mirror sheet cache is missing ${sheetName} during index sync.`);
      }
      await writeGoogleSheetsMirrorSheet(config, updatedSheet);
      updatedIndex = updateMirrorIndexEntry(updatedIndex, updatedSheet, verifiedAt);
    }
    await writeGoogleSheetsMirrorIndex(config, updatedIndex);

    logger?.info('mirror.verify_completed', {
      spreadsheetId: index.spreadsheetId,
      mutationCount: contexts.length,
      sheetNames: uniqueSheetNames,
      mutationIds: contexts.map((context) => context.mutation.mutationId),
      verifiedCellCount: results.reduce((sum, result) => sum + result.verifiedCells.length, 0),
      verifiedAt,
    });

    logger?.info('mirror.apply_completed', {
      spreadsheetId: index.spreadsheetId,
      mutationCount: contexts.length,
      sheetNames: uniqueSheetNames,
      mutationIds: contexts.map((context) => context.mutation.mutationId),
      writeRangeCount: plannedWriteRanges.length,
      verifiedCellCount: results.reduce((sum, result) => sum + result.verifiedCells.length, 0),
      writeMethod: batchWriteMethod,
    });
    logger?.info('mirror.authority_session_updated', {
      spreadsheetId: index.spreadsheetId,
      syncAuthorityMode: finalAuthorityState.syncAuthorityMode,
      writeSessionStatus: finalAuthorityState.writeSessionStatus,
      activeWriteSessionId: finalAuthorityState.activeWriteSessionId,
      activeWriteScope: finalAuthorityState.activeWriteScope,
      lastAuthoritativeSource: finalAuthorityState.lastAuthoritativeSource,
    });

    return {
      mutationCount: contexts.length,
      sheetNames: uniqueSheetNames,
      writeMethod: batchWriteMethod,
      writeRangeCount: plannedWriteRanges.length,
      writeResults,
      clearResults,
      sacredSentinelRanges: uniqueSacredSentinelRanges,
      verifiedAt,
      results,
    };
  } catch (error) {
    const conflictAuthorityAt = new Date().toISOString();
    const conflictAuthorityState = buildMirrorAuthorityStateForPendingSheets(
      allSheets,
      verifyingAuthorityState,
      conflictAuthorityAt,
      {
        status: 'conflict',
        mode: 'conflict',
        activeWriteSource: 'mirror_write_contract',
        lastAuthoritativeSource: verifyingAuthorityState.lastAuthoritativeSource,
        conflictReason: error instanceof Error ? error.message : String(error),
      },
    );
    await writeGoogleSheetsMirrorIndex(config, {
      ...index,
      authorityState: conflictAuthorityState,
    });
    logger?.error('mirror.authority_conflict', {
      spreadsheetId: index.spreadsheetId,
      syncAuthorityMode: conflictAuthorityState.syncAuthorityMode,
      writeSessionStatus: conflictAuthorityState.writeSessionStatus,
      activeWriteSessionId: conflictAuthorityState.activeWriteSessionId,
      activeWriteScope: conflictAuthorityState.activeWriteScope,
      message: error instanceof Error ? error.message : String(error),
    });
    logger?.error('mirror.verify_failed', {
      spreadsheetId: index.spreadsheetId,
      mutationCount: contexts.length,
      sheetNames: uniqueSheetNames,
      mutationIds: contexts.map((context) => context.mutation.mutationId),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function readGoogleSheetsMirrorValidationSnapshot(
  config: AppConfig,
  requestedRanges: readonly string[],
): Promise<GoogleSheetsMirrorValidationSnapshot[]> {
  const client = await createGoogleSheetsWriteClient(config);
  const ranges = await client.readGridRanges(requestedRanges);
  return ranges.map((range) => ({
    requestedRange: range.requestedRange,
    rows: range.rows.map((row) =>
      row.map((cell) => ({
        conditionType: cell.dataValidation?.conditionType ?? null,
        values: cell.dataValidation?.values ?? [],
        strict: cell.dataValidation?.strict ?? false,
        showCustomUi: cell.dataValidation?.showCustomUi ?? false,
        formattedValue: cell.formattedValue,
        formula: cell.formula,
      })),
    ),
  }));
}

export function buildStokMotorValidationRanges(targetRow: number): string[] {
  return [
    `STOK MOTOR!E${targetRow}:E${targetRow}`,
    `STOK MOTOR!M${targetRow}:M${targetRow}`,
  ];
}

export function resolveMirrorAppendTargetRow(sheet: GoogleSheetsMirrorSheet): number {
  if (sheet.sheetName === 'TOTAL ASET') {
    throw new Error('TOTAL ASET is full read only.');
  }

  return Math.max(sheet.lastDataRow, 1) + 1;
}

export function buildRuntimeMirrorBlockedAttempt(
  sheetName: GoogleSheetsMirrorSheetName,
  row: number,
  col: number,
): GoogleSheetsMirrorWriteEligibility {
  return inspectGoogleSheetsMirrorCellEligibility(sheetName, row, col);
}

export function listGoogleSheetsMirrorSheetNames(): GoogleSheetsMirrorSheetName[] {
  return [...GOOGLE_SHEETS_MIRROR_SHEET_NAMES];
}

function assertWritableSheet(sheetName: GoogleSheetsMirrorSheetName): asserts sheetName is GoogleSheetsMirrorWritableSheetName {
  if (sheetName === 'TOTAL ASET') {
    throw new Error('TOTAL ASET is full read only.');
  }
}

function assertExistingWritableRow(sheet: GoogleSheetsMirrorSheet, targetRow: number): void {
  if (!Number.isInteger(targetRow) || targetRow <= 1) {
    throw new Error('Mirror target row must be greater than header row.');
  }

  if (targetRow > sheet.lastDataRow) {
    throw new Error(`Mirror target row ${targetRow} does not exist in ${sheet.sheetName}.`);
  }
}

async function persistMirrorMutation(
  config: AppConfig,
  sheet: GoogleSheetsMirrorSheet,
  input: {
    mutationType: GoogleSheetsMirrorPendingMutation['mutationType'];
    createdAt: string;
    targetRow: number;
    cells: GoogleSheetsMirrorPendingMutationCell[];
  },
  logger?: Logger,
): Promise<GoogleSheetsMirrorMutationResult> {
  const index = await readGoogleSheetsMirrorIndex(config);
  const currentSheets = await readAllGoogleSheetsMirrorSheets(config, {
    [sheet.sheetName]: sheet,
  });
  const currentAuthorityState = normalizeGoogleSheetsMirrorAuthorityState(index.authorityState);
  assertAuthorityStateAllowsMutation(currentAuthorityState, currentSheets);
  const plannedWriteRanges = planMirrorWriteRanges(sheet.sheetName, input.targetRow, input.cells);
  const mutationId = buildMirrorMutationId(sheet.sheetName, input.targetRow, input.createdAt);
  const mutationCells = input.cells.map((cell) => ({
    ...cell,
    baselineValue: readGoogleSheetsMirrorCellValue(sheet, cell.row, cell.col),
  }));
  const pendingMutation: GoogleSheetsMirrorPendingMutation = {
    mutationId,
    mutationType: input.mutationType,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    targetRow: input.targetRow,
    writeRanges: plannedWriteRanges.map((range) => range.range),
    cells: mutationCells,
  };

  const nextValueCells = input.mutationType === 'clear_cells'
    ? removeMirrorValueCells(sheet.valueCells, mutationCells)
    : upsertMirrorValueCells(sheet.valueCells, mutationCells);
  const updatedSheet = recalculateGoogleSheetsMirrorSheet({
    ...sheet,
    valueCells: nextValueCells,
    pendingMutations: [...sheet.pendingMutations, pendingMutation],
  });
  const updatedSheets = currentSheets.map((entry) =>
    entry.sheetName === updatedSheet.sheetName ? updatedSheet : entry,
  );
  const updatedAuthorityState = buildMirrorAuthorityStateForPendingSheets(
    updatedSheets,
    currentAuthorityState,
    input.createdAt,
    {
      status: 'active',
      mode: 'mirror_authoritative',
      activeWriteSource: 'mirror_write_contract',
      lastAuthoritativeSource: currentAuthorityState.lastAuthoritativeSource,
      conflictReason: null,
    },
  );
  const updatedIndex = updateMirrorIndexEntry({
    ...index,
    authorityState: updatedAuthorityState,
  }, updatedSheet);

  await writeGoogleSheetsMirrorSheet(config, updatedSheet);
  await writeGoogleSheetsMirrorIndex(config, updatedIndex);

  logger?.info('mirror.mutation_created', {
    spreadsheetId: updatedSheet.spreadsheetId,
    sheetName: updatedSheet.sheetName,
    mutationId,
    mutationType: input.mutationType,
    targetRow: input.targetRow,
    cellCount: input.cells.length,
    activeWriteSessionId: updatedAuthorityState.activeWriteSessionId,
    syncAuthorityMode: updatedAuthorityState.syncAuthorityMode,
  });

  return {
    mutationId,
    mutationType: input.mutationType,
    sheetName: updatedSheet.sheetName,
    targetRow: input.targetRow,
    cellCount: input.cells.length,
    pendingMutationCount: updatedSheet.pendingMutations.length,
  };
}

function resolveDeleteCells(
  sheetName: GoogleSheetsMirrorWritableSheetName,
  targetRow: number,
): GoogleSheetsMirrorPendingMutationCell[] {
  const targetColumns = sheetName === 'STOK MOTOR'
    ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13]
    : [1, 2, 3, 4, 5, 6];

  return targetColumns.map((col) => {
    const eligibility = inspectGoogleSheetsMirrorCellEligibility(sheetName, targetRow, col);
    if (!eligibility.allowed) {
      throw new Error(eligibility.reason ?? 'Mirror delete is not allowed.');
    }

    return {
      row: targetRow,
      col,
      a1: toA1(targetRow, col),
      value: '',
      valueKind: inferMirrorValueKind(sheetName, col),
      baselineValue: null,
    };
  });
}

function normalizeWriteCells(
  sheetName: GoogleSheetsMirrorSheetName,
  targetRow: number,
  cells: Array<{ col: number; value: string | number | boolean }>,
  options: {
    allowEmptyText: boolean;
  },
): GoogleSheetsMirrorPendingMutationCell[] {
  if (cells.length === 0) {
    throw new Error('Mirror mutation must contain at least one value cell.');
  }

  const seenColumns = new Set<number>();
  const normalizedCells = cells.map((cell) => {
    if (!Number.isInteger(cell.col) || cell.col <= 0) {
      throw new Error('Mirror mutation column indexes must be positive integers.');
    }

    if (seenColumns.has(cell.col)) {
      throw new Error(`Mirror mutation contains a duplicate column ${cell.col}.`);
    }
    seenColumns.add(cell.col);

    const eligibility = inspectGoogleSheetsMirrorCellEligibility(sheetName, targetRow, cell.col);
    if (!eligibility.allowed) {
      throw new Error(eligibility.reason ?? 'Mirror mutation is not allowed.');
    }

    const valueKind = inferMirrorValueKind(sheetName, cell.col);
    const normalizedValue = normalizeMirrorMutationValue(
      cell.value,
      valueKind,
      sheetName,
      cell.col,
      options,
    );
    return {
      row: targetRow,
      col: cell.col,
      a1: toA1(targetRow, cell.col),
      value: normalizedValue,
      valueKind,
      baselineValue: null,
    };
  });

  return normalizedCells.sort((left, right) => left.col - right.col);
}

function planMirrorWriteRanges(
  sheetName: GoogleSheetsMirrorSheetName,
  targetRow: number,
  cells: readonly GoogleSheetsMirrorPendingMutationCell[],
): PlannedMirrorWriteRange[] {
  if (cells.length === 0) {
    throw new Error('Mirror mutation has no cells to write.');
  }

  const groups: GoogleSheetsMirrorPendingMutationCell[][] = [];
  for (const cell of cells) {
    const currentGroup = groups.at(-1);
    if (!currentGroup || currentGroup.at(-1)!.col + 1 !== cell.col) {
      groups.push([cell]);
      continue;
    }

    currentGroup.push(cell);
  }

  return groups.map((group) => {
    const startCol = group[0]!.col;
    const endCol = group.at(-1)!.col;
    return {
      range: `${sheetName}!${toA1(targetRow, startCol)}:${toA1(targetRow, endCol)}`,
      startCol,
      cells: group,
      values: [
        group.map((cell) => cell.value),
      ],
    };
  });
}

function buildSacredSentinelRanges(
  sheetName: GoogleSheetsMirrorSheetName,
  targetRow: number,
): string[] {
  if (sheetName === 'STOK MOTOR') {
    return [
      'STOK MOTOR!A1:M1',
      `STOK MOTOR!A${targetRow}:A${targetRow}`,
      `STOK MOTOR!K${targetRow}:K${targetRow}`,
    ];
  }

  if (sheetName === 'PENGELUARAN HARIAN') {
    return ['PENGELUARAN HARIAN!A1:F1'];
  }

  return ['TOTAL ASET!A1:B20'];
}

function verifyMirrorMutationCells(
  plannedWriteRanges: readonly PlannedMirrorWriteRange[],
  formattedRanges: readonly { rows: string[][] }[],
  rawRanges: readonly GoogleSheetsTypedRangeSample[],
): GoogleSheetsMirrorValueCell[] {
  return plannedWriteRanges.flatMap((plannedRange, rangeIndex) => {
    const formattedRow = formattedRanges[rangeIndex]?.rows[0] ?? [];
    const rawRow = rawRanges[rangeIndex]?.rows[0] ?? [];

    return plannedRange.cells.map((cell, cellIndex) => {
      const formattedValue = formattedRow[cellIndex] ?? '';
      const rawValue = rawRow[cellIndex] ?? '';
      assertVerifiedCellValueMatches(cell, formattedValue, rawValue);
      return {
        row: cell.row,
        col: cell.col,
        a1: cell.a1,
        value: formattedValue,
      };
    });
  });
}

function verifyMirrorClearCells(
  plannedWriteRanges: readonly PlannedMirrorWriteRange[],
  formattedRanges: readonly { rows: string[][] }[],
): GoogleSheetsMirrorValueCell[] {
  return plannedWriteRanges.flatMap((plannedRange, rangeIndex) => {
    const formattedRow = formattedRanges[rangeIndex]?.rows[0] ?? [];

    return plannedRange.cells.map((cell, cellIndex) => {
      const formattedValue = formattedRow[cellIndex] ?? '';
      if (formattedValue.trim().length > 0) {
        throw new Error(`Mirror verify mismatch at ${cell.a1}. Expected cleared cell but got "${formattedValue}".`);
      }
      return {
        row: cell.row,
        col: cell.col,
        a1: cell.a1,
        value: '',
      };
    });
  });
}

function assertVerifiedCellValueMatches(
  cell: GoogleSheetsMirrorPendingMutationCell,
  formattedValue: string,
  rawValue: string | number | boolean,
): void {
  if (cell.value === '') {
    if (formattedValue.trim().length > 0) {
      throw new Error(
        `Mirror verify mismatch at ${cell.a1}. Expected cleared cell but got "${formattedValue}".`,
      );
    }
    return;
  }

  if (cell.valueKind === 'number') {
    if (typeof rawValue !== 'number' || rawValue !== cell.value) {
      throw new Error(
        `Mirror verify mismatch at ${cell.a1}. Expected raw number ${String(cell.value)} but got ${String(rawValue)}.`,
      );
    }
    return;
  }

  if (cell.valueKind === 'boolean') {
    if (typeof rawValue !== 'boolean' || rawValue !== cell.value) {
      throw new Error(
        `Mirror verify mismatch at ${cell.a1}. Expected raw boolean ${String(cell.value)} but got ${String(rawValue)}.`,
      );
    }
    return;
  }

  if (formattedValue !== String(cell.value)) {
    throw new Error(
      `Mirror verify mismatch at ${cell.a1}. Expected formatted value "${String(cell.value)}" but got "${formattedValue}".`,
    );
  }
}

function assertSacredSentinelsStable(
  before: readonly GoogleSheetsTypedRangeSample[],
  after: readonly GoogleSheetsTypedRangeSample[],
): void {
  const beforeSnapshot = JSON.stringify(before);
  const afterSnapshot = JSON.stringify(after);

  if (beforeSnapshot !== afterSnapshot) {
    throw new Error('Sacred sentinel ranges changed during mirror apply.');
  }
}

function resolveMirrorBatchWriteMethod(
  contexts: readonly LoadedMirrorMutationContext[],
): 'batchUpdate' | 'batchClear' | 'mixed' {
  const methods = new Set(contexts.map((context) => context.writeMethod));
  if (methods.size === 1) {
    return methods.has('batchClear') ? 'batchClear' : 'batchUpdate';
  }

  return 'mixed';
}

function normalizeMirrorMutationValue(
  value: string | number | boolean,
  valueKind: GoogleSheetsMirrorValueKind,
  sheetName: GoogleSheetsMirrorSheetName,
  col: number,
  options: {
    allowEmptyText: boolean;
  },
): GoogleSheetsWriteInputValue {
  if (valueKind === 'number') {
    const parsed = normalizeNumberValue(value);
    if (parsed === null) {
      throw new Error(`Column ${toA1(0, col).replace('0', '')} in ${sheetName} requires a numeric value.`);
    }
    return parsed;
  }

  if (valueKind === 'boolean') {
    const parsed = normalizeBooleanValue(value);
    if (parsed === null) {
      throw new Error(`Column ${toA1(0, col).replace('0', '')} in ${sheetName} requires a boolean value.`);
    }
    return parsed;
  }

  const normalizedText = typeof value === 'string' ? value.trim() : String(value).trim();
  if (!options.allowEmptyText && normalizedText.length === 0) {
    throw new Error(`Column ${toA1(0, col).replace('0', '')} in ${sheetName} does not accept empty values.`);
  }
  return normalizedText;
}

function inferMirrorValueKind(
  sheetName: GoogleSheetsMirrorSheetName,
  col: number,
): GoogleSheetsMirrorValueKind {
  if (sheetName === 'PENGELUARAN HARIAN') {
    if (col === 1) {
      return 'date-text';
    }

    if (col === 3 || col === 6) {
      return 'number';
    }

    return 'text';
  }

  if (sheetName === 'STOK MOTOR') {
    if (col === 10) {
      return 'date-text';
    }

    if (col === 13) {
      return 'boolean';
    }

    if ([3, 6, 7, 8, 9, 12].includes(col)) {
      return 'number';
    }

    return 'text';
  }

  return 'text';
}

function normalizeNumberValue(value: string | number | boolean): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed
    .replace(/^(-)?Rp/iu, '$1')
    .replace(/\s+/gu, '')
    .replace(/\./gu, '')
    .replace(/,/gu, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBooleanValue(value: string | number | boolean): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return null;
}

function upsertMirrorValueCells(
  existingCells: readonly GoogleSheetsMirrorValueCell[],
  cells: readonly Pick<GoogleSheetsMirrorPendingMutationCell, 'row' | 'col' | 'a1' | 'value'>[],
): GoogleSheetsMirrorValueCell[] {
  const nextCells = new Map<string, GoogleSheetsMirrorValueCell>();
  for (const cell of existingCells) {
    nextCells.set(`${cell.row}:${cell.col}`, cell);
  }

  for (const cell of cells) {
    if (typeof cell.value === 'string' && cell.value.trim().length === 0) {
      nextCells.delete(`${cell.row}:${cell.col}`);
      continue;
    }

    nextCells.set(`${cell.row}:${cell.col}`, {
      row: cell.row,
      col: cell.col,
      a1: cell.a1,
      value: typeof cell.value === 'string' ? cell.value : String(cell.value),
    });
  }

  return [...nextCells.values()];
}

function removeMirrorValueCells(
  existingCells: readonly GoogleSheetsMirrorValueCell[],
  cellsToRemove: readonly Pick<GoogleSheetsMirrorPendingMutationCell, 'row' | 'col'>[],
): GoogleSheetsMirrorValueCell[] {
  const removalKeys = new Set(cellsToRemove.map((cell) => `${cell.row}:${cell.col}`));
  return existingCells.filter((cell) => !removalKeys.has(`${cell.row}:${cell.col}`));
}

function updateMirrorIndexEntry(
  index: GoogleSheetsMirrorIndex,
  sheet: GoogleSheetsMirrorSheet,
  syncedAtOverride?: string,
): GoogleSheetsMirrorIndex {
  const entries = index.sheets.map((entry) =>
    entry.sheetName === sheet.sheetName
      ? buildMirrorIndexEntryFromSheet(sheet, syncedAtOverride ?? entry.syncedAt)
      : entry,
  );

  return {
    ...index,
    syncedAt: syncedAtOverride ?? index.syncedAt,
    sheetCount: entries.length,
    mirrorCellCount: entries.reduce((sum, entry) => sum + entry.nonEmptyCellCount, 0),
    sheets: entries,
  };
}

function buildMirrorIndexEntryFromSheet(
  sheet: GoogleSheetsMirrorSheet,
  syncedAt: string,
): GoogleSheetsMirrorIndexEntry {
  return {
    sheetName: sheet.sheetName,
    sheetId: sheet.sheetId,
    fileName: `${sheet.sheetName.toLowerCase().replace(/[^\w]+/gu, '-').replace(/^-+|-+$/gu, '')}.json`,
    syncedAt,
    discoveryMode: sheet.discoveryMode,
    lastDiscoveryRange: sheet.lastDiscoveryRange,
    nonEmptyRowCount: sheet.nonEmptyRowCount,
    nonEmptyCellCount: sheet.nonEmptyCellCount,
    lastDataRow: sheet.lastDataRow,
  };
}

async function readAllGoogleSheetsMirrorSheets(
  config: AppConfig,
  preload: Partial<Record<GoogleSheetsMirrorSheetName, GoogleSheetsMirrorSheet>> = {},
): Promise<GoogleSheetsMirrorSheet[]> {
  const sheets: GoogleSheetsMirrorSheet[] = [];

  for (const sheetName of GOOGLE_SHEETS_MIRROR_SHEET_NAMES) {
    const preloaded = preload[sheetName];
    sheets.push(preloaded ?? (await readGoogleSheetsMirrorSheet(config, sheetName)));
  }

  return sheets;
}

function assertAuthorityStateAllowsMutation(
  authorityState: GoogleSheetsMirrorAuthorityState,
  sheets: readonly GoogleSheetsMirrorSheet[],
): void {
  if (authorityState.syncAuthorityMode === 'conflict' || authorityState.writeSessionStatus === 'conflict') {
    throw new Error(
      authorityState.lastAuthorityConflictReason ??
        'Mirror write session is in conflict state and must be resolved before new mutations are created.',
    );
  }

  if (hasGoogleSheetsMirrorPendingMutations(sheets) && authorityState.syncAuthorityMode !== 'mirror_authoritative') {
    throw new Error('Mirror contains pending mutations but authority state is not mirror_authoritative.');
  }
}

function assertAuthorityStateAllowsApply(
  authorityState: GoogleSheetsMirrorAuthorityState,
  sheets: readonly GoogleSheetsMirrorSheet[],
  contexts: readonly LoadedMirrorMutationContext[],
): void {
  if (authorityState.syncAuthorityMode === 'conflict' || authorityState.writeSessionStatus === 'conflict') {
    throw new Error(
      authorityState.lastAuthorityConflictReason ??
        'Mirror authority is in conflict state and batch apply is fail-closed.',
    );
  }

  if (!hasGoogleSheetsMirrorPendingMutations(sheets)) {
    throw new Error('Mirror batch apply requires an active write session with pending mutations.');
  }

  if (authorityState.syncAuthorityMode !== 'mirror_authoritative') {
    throw new Error('Mirror batch apply is blocked because authority is not mirror_authoritative.');
  }

  if (authorityState.activeWriteSource !== 'mirror_write_contract') {
    throw new Error('Mirror batch apply is blocked because the active write source is not mirror_write_contract.');
  }

  const activeScope = new Set(authorityState.activeWriteScope);
  for (const context of contexts) {
    for (const writeRange of context.mutation.writeRanges) {
      if (!activeScope.has(writeRange)) {
        throw new Error(`Mirror batch apply target ${writeRange} is outside the active write scope.`);
      }
    }
  }
}

function buildMirrorAuthorityStateForPendingSheets(
  sheets: readonly GoogleSheetsMirrorSheet[],
  previousState: GoogleSheetsMirrorAuthorityState,
  updatedAt: string,
  options: {
    status:
      | 'idle'
      | 'active'
      | 'verifying'
      | 'committed'
      | 'failed'
      | 'conflict';
    mode: 'live_authoritative' | 'mirror_authoritative' | 'conflict';
    activeWriteSource: GoogleSheetsMirrorAuthoritativeSource | null;
    lastAuthoritativeSource: GoogleSheetsMirrorAuthoritativeSource | null;
    conflictReason: string | null;
  },
): GoogleSheetsMirrorAuthorityState {
  const scope = buildGoogleSheetsMirrorAuthorityScope(sheets);
  const hasPending = scope.length > 0;

  if (!hasPending || options.mode === 'live_authoritative') {
    const defaultState = buildDefaultGoogleSheetsMirrorAuthorityState(updatedAt);
    return {
      ...defaultState,
      syncAuthorityMode: 'live_authoritative',
      writeSessionStatus: 'idle',
      lastAuthoritativeSource: options.lastAuthoritativeSource,
      lastAuthorityConflictReason: options.conflictReason,
    };
  }

  return {
    syncAuthorityMode: options.mode,
    activeWriteSessionId: previousState.activeWriteSessionId ?? buildMirrorWriteSessionId(updatedAt),
    activeWriteScope: scope,
    activeWriteSource: options.activeWriteSource,
    writeSessionStatus: options.status,
    lastAuthoritativeSource: options.lastAuthoritativeSource,
    lastAuthorityConflictReason: options.conflictReason,
    updatedAt,
  };
}

function buildMirrorWriteSessionId(createdAt: string): string {
  return `mirror-write-${createdAt.replace(/[^\d]/gu, '').slice(0, 17)}`;
}

function buildMirrorMutationId(
  sheetName: GoogleSheetsMirrorSheetName,
  targetRow: number,
  createdAt: string,
): string {
  const slug = sheetName.toLowerCase().replace(/[^\w]+/gu, '-').replace(/^-+|-+$/gu, '');
  return `${slug}-r${targetRow}-${createdAt.replace(/[^\d]/gu, '').slice(0, 14)}`;
}
