import { pathToFileURL } from 'node:url';

import type { Logger } from '../core/logger.js';
import { createLogger } from '../core/logger.js';
import { loadAppConfig, type AppConfig } from '../config/app-config.js';
import {
  createGoogleSheetsReadClient,
  type GoogleSheetsAuthResult,
  type GoogleSheetsReadClient,
  type GoogleSheetsSpreadsheetMetadata,
} from './google-sheets-client.js';
import {
  buildDefaultGoogleSheetsMirrorAuthorityState,
  buildGoogleSheetsDiscoveryRequestRange,
  buildGoogleSheetsMirrorIndex,
  buildGoogleSheetsMirrorSheet,
  GOOGLE_SHEETS_MIRROR_SHEET_NAMES,
  hasGoogleSheetsMirrorPendingMutations,
  normalizeGoogleSheetsMirrorAuthorityState,
  persistGoogleSheetsMirror,
  readGoogleSheetsMirrorCellValue,
  readGoogleSheetsMirrorIndex,
  readGoogleSheetsMirrorSheet,
  recalculateGoogleSheetsMirrorSheet,
  writeGoogleSheetsMirrorIndex,
  type GoogleSheetsMirrorIndex,
  type GoogleSheetsMirrorAuthorityState,
  type GoogleSheetsMirrorPendingMutationCell,
  type GoogleSheetsMirrorSheet,
} from './google-sheets-mirror.js';

export interface GoogleSheetsMirrorSyncVerificationSheet {
  sheetName: GoogleSheetsMirrorSheet['sheetName'];
  syncedAt: string;
  nonEmptyCellCount: number;
  lastDataRow: number;
}

export interface GoogleSheetsMirrorSyncVerification {
  verifiedAt: string;
  mirrorCellCount: number;
  sheetCount: number;
  sheets: GoogleSheetsMirrorSyncVerificationSheet[];
}

export interface GoogleSheetsMirrorSyncResult {
  syncedAt: string;
  auth: GoogleSheetsAuthResult;
  metadata: GoogleSheetsSpreadsheetMetadata;
  mirrorIndex: GoogleSheetsMirrorIndex;
  mirrorSheets: GoogleSheetsMirrorSheet[];
  verification: GoogleSheetsMirrorSyncVerification;
}

export interface GoogleSheetsMirrorSyncDependencies {
  logger?: Logger;
  readClient?: GoogleSheetsReadClient;
  syncedAt?: string;
}

export async function syncGoogleSheetsMirror(
  config: AppConfig,
  dependencies: GoogleSheetsMirrorSyncDependencies = {},
): Promise<GoogleSheetsMirrorSyncResult> {
  const logger = dependencies.logger ?? createLogger(config.logFilePath);
  const syncedAt = dependencies.syncedAt ?? new Date().toISOString();

  logger.info('mirror.sync_started', {
    spreadsheetId: config.googleSheetsSpreadsheetId,
    sheetCount: GOOGLE_SHEETS_MIRROR_SHEET_NAMES.length,
    mirrorMode: 'value-only-sparse',
  });

  try {
    const client = dependencies.readClient ?? (await createGoogleSheetsReadClient(config));
    const auth = await client.authenticate();
    const metadata = await client.readSpreadsheetMetadata();
    const mirrorSheets: GoogleSheetsMirrorSheet[] = [];

    for (const sheetName of GOOGLE_SHEETS_MIRROR_SHEET_NAMES) {
      logger.info('mirror.sheet_started', {
        spreadsheetId: metadata.spreadsheetId,
        sheetName,
      });

      try {
        const sheetMetadata = metadata.sheets.find((sheet) => sheet.title === sheetName);
        const requestRange = buildGoogleSheetsDiscoveryRequestRange(sheetName, sheetMetadata?.columnCount ?? null);
        const [rangeSample] = await client.readRanges([requestRange]);
        if (!rangeSample) {
          throw new Error(`No Google Sheets values response was returned for sheet ${sheetName}.`);
        }

        const mirrorSheet = buildGoogleSheetsMirrorSheet(metadata, rangeSample, sheetName, syncedAt);
        mirrorSheets.push(mirrorSheet);

        logger.info('mirror.sheet_completed', {
          spreadsheetId: metadata.spreadsheetId,
          sheetName,
          nonEmptyRowCount: mirrorSheet.nonEmptyRowCount,
          nonEmptyCellCount: mirrorSheet.nonEmptyCellCount,
          lastDataRow: mirrorSheet.lastDataRow,
          lastDiscoveryRange: mirrorSheet.lastDiscoveryRange,
        });
      } catch (error) {
        logger.error('mirror.sheet_failed', {
          spreadsheetId: metadata.spreadsheetId,
          sheetName,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const persistedMirror = await readPersistedGoogleSheetsMirrorState(config);
    let authorityDecision: {
      authorityState: GoogleSheetsMirrorAuthorityState;
      mirrorSheets: GoogleSheetsMirrorSheet[];
    };
    try {
      authorityDecision = reconcileMirrorAuthorityState({
        logger,
        syncedAt,
        persistedMirrorIndex: persistedMirror?.index ?? null,
        persistedSheets: persistedMirror?.sheets ?? [],
        liveSheets: mirrorSheets,
        spreadsheetId: metadata.spreadsheetId,
      });
    } catch (error) {
      if (persistedMirror && hasGoogleSheetsMirrorPendingMutations(persistedMirror.sheets)) {
        const conflictAuthorityState = buildConflictAuthorityState(
          persistedMirror.index.authorityState,
          error instanceof Error ? error.message : String(error),
          syncedAt,
        );
        await writeGoogleSheetsMirrorIndex(config, {
          ...persistedMirror.index,
          authorityState: conflictAuthorityState,
        });
        logger.error('mirror.authority_conflict', {
          spreadsheetId: metadata.spreadsheetId,
          syncAuthorityMode: conflictAuthorityState.syncAuthorityMode,
          writeSessionStatus: conflictAuthorityState.writeSessionStatus,
          activeWriteSessionId: conflictAuthorityState.activeWriteSessionId,
          activeWriteScope: conflictAuthorityState.activeWriteScope,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
    const mirrorIndex = buildGoogleSheetsMirrorIndex(
      config,
      metadata,
      authorityDecision.mirrorSheets,
      syncedAt,
      authorityDecision.authorityState,
    );
    await persistGoogleSheetsMirror(config, mirrorIndex, authorityDecision.mirrorSheets);

    logger.info('mirror.verify_started', {
      spreadsheetId: metadata.spreadsheetId,
      sheetCount: mirrorIndex.sheetCount,
      mirrorCellCount: mirrorIndex.mirrorCellCount,
    });

    const verification = await verifyPersistedGoogleSheetsMirror(
      config,
      mirrorIndex,
      authorityDecision.mirrorSheets,
    );

    logger.info('mirror.verify_completed', {
      spreadsheetId: metadata.spreadsheetId,
      verifiedAt: verification.verifiedAt,
      sheetCount: verification.sheetCount,
      mirrorCellCount: verification.mirrorCellCount,
    });

    logger.info('mirror.sync_completed', {
      spreadsheetId: metadata.spreadsheetId,
      sheetCount: mirrorIndex.sheetCount,
      mirrorCellCount: mirrorIndex.mirrorCellCount,
      mirrorMode: mirrorIndex.mirrorMode,
    });

    return {
      syncedAt,
      auth,
      metadata,
      mirrorIndex,
      mirrorSheets: authorityDecision.mirrorSheets,
      verification,
    };
  } catch (error) {
    logger.error('mirror.sync_failed', {
      spreadsheetId: config.googleSheetsSpreadsheetId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function verifyPersistedGoogleSheetsMirror(
  config: AppConfig,
  expectedIndex: GoogleSheetsMirrorIndex,
  expectedSheets: GoogleSheetsMirrorSheet[],
): Promise<GoogleSheetsMirrorSyncVerification> {
  const persistedIndex = await readGoogleSheetsMirrorIndex(config);
  if (persistedIndex.spreadsheetId !== expectedIndex.spreadsheetId) {
    throw new Error('Persisted mirror index spreadsheetId does not match the live sync result.');
  }
  if (persistedIndex.sheetCount !== expectedIndex.sheetCount) {
    throw new Error('Persisted mirror index sheetCount does not match the live sync result.');
  }
  if (persistedIndex.mirrorCellCount !== expectedIndex.mirrorCellCount) {
    throw new Error('Persisted mirror index mirrorCellCount does not match the live sync result.');
  }
  if (persistedIndex.syncedAt !== expectedIndex.syncedAt) {
    throw new Error('Persisted mirror index syncedAt does not match the live sync result.');
  }
  if (JSON.stringify(persistedIndex.authorityState) !== JSON.stringify(expectedIndex.authorityState)) {
    throw new Error('Persisted mirror index authorityState does not match the live sync result.');
  }

  const verifiedSheets: GoogleSheetsMirrorSyncVerificationSheet[] = [];

  for (const expectedSheet of expectedSheets) {
    const persistedSheet = await readGoogleSheetsMirrorSheet(config, expectedSheet.sheetName);
    if (JSON.stringify(persistedSheet) !== JSON.stringify(expectedSheet)) {
      throw new Error(`Persisted mirror sheet ${expectedSheet.sheetName} does not match the live sync result.`);
    }

    verifiedSheets.push({
      sheetName: persistedSheet.sheetName,
      syncedAt: persistedSheet.syncedAt,
      nonEmptyCellCount: persistedSheet.nonEmptyCellCount,
      lastDataRow: persistedSheet.lastDataRow,
    });
  }

  return {
    verifiedAt: new Date().toISOString(),
    mirrorCellCount: persistedIndex.mirrorCellCount,
    sheetCount: persistedIndex.sheetCount,
    sheets: verifiedSheets,
  };
}

async function readPersistedGoogleSheetsMirrorState(
  config: AppConfig,
): Promise<{
  index: GoogleSheetsMirrorIndex;
  sheets: GoogleSheetsMirrorSheet[];
} | null> {
  try {
    const index = await readGoogleSheetsMirrorIndex(config);
    const sheets: GoogleSheetsMirrorSheet[] = [];
    for (const sheetName of GOOGLE_SHEETS_MIRROR_SHEET_NAMES) {
      sheets.push(await readGoogleSheetsMirrorSheet(config, sheetName));
    }
    return { index, sheets };
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function reconcileMirrorAuthorityState(input: {
  logger: Logger;
  syncedAt: string;
  spreadsheetId: string;
  persistedMirrorIndex: GoogleSheetsMirrorIndex | null;
  persistedSheets: GoogleSheetsMirrorSheet[];
  liveSheets: GoogleSheetsMirrorSheet[];
}): {
  authorityState: GoogleSheetsMirrorAuthorityState;
  mirrorSheets: GoogleSheetsMirrorSheet[];
} {
  const persistedAuthorityState = normalizeGoogleSheetsMirrorAuthorityState(
    input.persistedMirrorIndex?.authorityState,
  );

  if (!input.persistedMirrorIndex || input.persistedSheets.length === 0) {
    const authorityState = buildLiveAuthoritativeState(input.syncedAt);
    input.logger.info('mirror.authority_live_applied', {
      spreadsheetId: input.spreadsheetId,
      syncAuthorityMode: authorityState.syncAuthorityMode,
      lastAuthoritativeSource: authorityState.lastAuthoritativeSource,
    });
    return {
      authorityState,
      mirrorSheets: input.liveSheets,
    };
  }

  const persistedPendingMutations = hasGoogleSheetsMirrorPendingMutations(input.persistedSheets);
  if (!persistedPendingMutations) {
    const authorityState = buildLiveAuthoritativeState(input.syncedAt);
    input.logger.info('mirror.authority_live_applied', {
      spreadsheetId: input.spreadsheetId,
      syncAuthorityMode: authorityState.syncAuthorityMode,
      lastAuthoritativeSource: authorityState.lastAuthoritativeSource,
    });
    return {
      authorityState,
      mirrorSheets: input.liveSheets,
    };
  }

  if (persistedAuthorityState.syncAuthorityMode === 'conflict') {
    throw new Error(
      persistedAuthorityState.lastAuthorityConflictReason ??
        'Mirror sync is blocked because authority state is already conflict.',
    );
  }

  if (
    persistedAuthorityState.syncAuthorityMode !== 'mirror_authoritative' ||
    persistedAuthorityState.activeWriteSource !== 'mirror_write_contract'
  ) {
    throw new Error(
      'Mirror sync found pending mutations without an active mirror_authoritative write session.',
    );
  }

  const liveSheetMap = new Map(input.liveSheets.map((sheet) => [sheet.sheetName, sheet]));
  const mergedSheets = input.persistedSheets.map((persistedSheet) => {
    const liveSheet = liveSheetMap.get(persistedSheet.sheetName);
    if (!liveSheet) {
      throw new Error(`Live sync is missing sheet ${persistedSheet.sheetName}.`);
    }

    return mergeLiveSheetWithMirrorAuthority({
      persistedSheet,
      liveSheet,
      authorityState: persistedAuthorityState,
    });
  });

  const authorityState: GoogleSheetsMirrorAuthorityState = {
    ...persistedAuthorityState,
    syncAuthorityMode: 'mirror_authoritative',
    activeWriteScope: collectAuthorityScopeFromSheets(mergedSheets),
    activeWriteSource: 'mirror_write_contract',
    writeSessionStatus: persistedAuthorityState.writeSessionStatus === 'failed' ? 'failed' : 'active',
    lastAuthorityConflictReason: null,
    updatedAt: input.syncedAt,
  };
  input.logger.info('mirror.authority_scope_preserved', {
    spreadsheetId: input.spreadsheetId,
    syncAuthorityMode: authorityState.syncAuthorityMode,
    writeSessionStatus: authorityState.writeSessionStatus,
    activeWriteSessionId: authorityState.activeWriteSessionId,
    activeWriteScope: authorityState.activeWriteScope,
  });

  return {
    authorityState,
    mirrorSheets: mergedSheets,
  };
}

function mergeLiveSheetWithMirrorAuthority(input: {
  persistedSheet: GoogleSheetsMirrorSheet;
  liveSheet: GoogleSheetsMirrorSheet;
  authorityState: GoogleSheetsMirrorAuthorityState;
}): GoogleSheetsMirrorSheet {
  const nextCells = new Map<string, { row: number; col: number; a1: string; value: string }>();

  for (const cell of input.liveSheet.valueCells) {
    nextCells.set(`${cell.row}:${cell.col}`, cell);
  }

  for (const mutation of input.persistedSheet.pendingMutations) {
    for (const cell of mutation.cells) {
      assertNoUnexpectedLiveMutationConflict(input.liveSheet, input.persistedSheet, cell, input.authorityState);
      const mirrorValue = readGoogleSheetsMirrorCellValue(input.persistedSheet, cell.row, cell.col);
      const key = `${cell.row}:${cell.col}`;
      if (mirrorValue === null || mirrorValue.trim().length === 0) {
        nextCells.delete(key);
        continue;
      }

      nextCells.set(key, {
        row: cell.row,
        col: cell.col,
        a1: cell.a1,
        value: mirrorValue,
      });
    }
  }

  return recalculateGoogleSheetsMirrorSheet({
    ...input.liveSheet,
    syncedAt: input.liveSheet.syncedAt,
    valueCells: [...nextCells.values()],
    pendingMutations: input.persistedSheet.pendingMutations,
  });
}

function assertNoUnexpectedLiveMutationConflict(
  liveSheet: GoogleSheetsMirrorSheet,
  persistedSheet: GoogleSheetsMirrorSheet,
  cell: GoogleSheetsMirrorPendingMutationCell,
  authorityState: GoogleSheetsMirrorAuthorityState,
): void {
  const liveValue = readGoogleSheetsMirrorCellValue(liveSheet, cell.row, cell.col);
  const persistedMirrorValue = readGoogleSheetsMirrorCellValue(persistedSheet, cell.row, cell.col);

  if (areMirrorValuesEqual(liveValue, persistedMirrorValue)) {
    return;
  }

  if (areMirrorValuesEqual(liveValue, cell.baselineValue)) {
    return;
  }

  throw new Error(
    authorityState.lastAuthorityConflictReason ??
      `Manual live change conflicted with active mirror write scope at ${cell.a1}.`,
  );
}

function collectAuthorityScopeFromSheets(sheets: readonly GoogleSheetsMirrorSheet[]): string[] {
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

function buildLiveAuthoritativeState(syncedAt: string): GoogleSheetsMirrorAuthorityState {
  return {
    ...buildDefaultGoogleSheetsMirrorAuthorityState(syncedAt),
    syncAuthorityMode: 'live_authoritative',
    writeSessionStatus: 'idle',
    lastAuthoritativeSource: 'live_manual',
    updatedAt: syncedAt,
  };
}

function buildConflictAuthorityState(
  currentState: GoogleSheetsMirrorAuthorityState,
  reason: string,
  updatedAt: string,
): GoogleSheetsMirrorAuthorityState {
  return {
    ...currentState,
    syncAuthorityMode: 'conflict',
    writeSessionStatus: 'conflict',
    lastAuthorityConflictReason: reason,
    updatedAt,
  };
}

function areMirrorValuesEqual(left: string | null, right: string | null): boolean {
  return (left ?? '') === (right ?? '');
}

async function main(): Promise<void> {
  const config = loadAppConfig();

  try {
    const result = await syncGoogleSheetsMirror(config);
    console.log(
      JSON.stringify(
        {
          ok: true,
          syncedAt: result.syncedAt,
          auth: result.auth,
          metadata: {
            spreadsheetId: result.metadata.spreadsheetId,
            title: result.metadata.title,
            locale: result.metadata.locale,
            timeZone: result.metadata.timeZone,
          },
          mirror: result.mirrorIndex,
          verification: result.verification,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main();
}
