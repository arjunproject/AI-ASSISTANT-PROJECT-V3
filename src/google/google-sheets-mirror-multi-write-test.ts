import assert from 'node:assert/strict';

import { createLogger } from '../core/logger.js';
import { loadAppConfig } from '../config/app-config.js';
import type { Logger } from '../core/logger.js';
import { createGoogleSheetsWriteClient, type GoogleSheetsTypedRangeSample } from './google-sheets-client.js';
import {
  applyGoogleSheetsMirrorMutationBatch,
  buildRuntimeMirrorBlockedAttempt,
  buildStokMotorValidationRanges,
  createGoogleSheetsMirrorAppendRowMutation,
  createGoogleSheetsMirrorConfirmSoldMutation,
  createGoogleSheetsMirrorDeleteRowMutation,
  createGoogleSheetsMirrorUpdateCellsMutation,
  readGoogleSheetsMirrorValidationSnapshot,
  recoverGoogleSheetsMirrorValidationFromNeighbor,
  resolveMirrorAppendTargetRow,
  type GoogleSheetsMirrorBatchMutationRef,
} from './google-sheets-mirror-write.js';
import { readGoogleSheetsMirrorSheet } from './google-sheets-mirror.js';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const logger = createLogger(config.logFilePath);
  const client = await createGoogleSheetsWriteClient(config);

  const totalAsetBefore = await client.readRangesWithRender(['TOTAL ASET!A1:B20'], 'FORMULA');
  const stokMirrorBefore = await readGoogleSheetsMirrorSheet(config, 'STOK MOTOR');
  const pengeluaranMirrorBefore = await readGoogleSheetsMirrorSheet(config, 'PENGELUARAN HARIAN');

  const stokExistingRows = resolveExistingStokRows(stokMirrorBefore, 3);
  const stokInsertRows = [
    resolveMirrorAppendTargetRow(stokMirrorBefore),
    resolveMirrorAppendTargetRow(stokMirrorBefore) + 1,
  ];
  const pengeluaranInsertRow = resolveMirrorAppendTargetRow(pengeluaranMirrorBefore);
  const validationTargetRows = uniqueRows([...stokExistingRows, ...stokInsertRows]);
  const sacredRanges = buildStokSacredRanges(validationTargetRows);
  const sacredBefore = await client.readRangesWithRender(sacredRanges, 'FORMULA');

  const blockedAttempts = [
    {
      sheetName: 'TOTAL ASET' as const,
      row: 2,
      col: 1,
    },
    {
      sheetName: 'STOK MOTOR' as const,
      row: stokInsertRows[0]!,
      col: 1,
    },
    {
      sheetName: 'STOK MOTOR' as const,
      row: stokInsertRows[0]!,
      col: 11,
    },
  ].map((attempt) => {
    const eligibility = buildRuntimeMirrorBlockedAttempt(attempt.sheetName, attempt.row, attempt.col);
    if (!eligibility.allowed) {
      logger.warn('mirror.sacred_blocked', {
        spreadsheetId: config.googleSheetsSpreadsheetId,
        sheetName: attempt.sheetName,
        row: attempt.row,
        col: attempt.col,
        message: eligibility.reason,
      });
    }

    return {
      ...attempt,
      ...eligibility,
    };
  });

  const validationRecovery = await ensureStokValidationRows(config, logger, validationTargetRows);
  const validationBefore = await captureValidationForRows(
    config,
    logger,
    validationTargetRows,
    'before_multi_write',
  );

  const runtimeStamp = Date.now();
  const insertNames = stokInsertRows.map((_, index) => `RUNTIME MULTI STOK ${runtimeStamp}-${index + 1}`);
  const soldDates = [
    'Minggu, 12 April 2026',
    'Senin, 13 April 2026',
    'Selasa, 14 April 2026',
  ];
  const expenseDescription = `RUNTIME MULTI EXPENSE ${runtimeStamp}`;

  const insertMutations = [];
  for (const [index, name] of insertNames.entries()) {
    insertMutations.push(
      await createGoogleSheetsMirrorAppendRowMutation(
        config,
        {
          sheetName: 'STOK MOTOR',
          cells: [
            { col: 2, value: name },
            { col: 3, value: 2020 + index },
            { col: 4, value: `L TEST ${index + 1}` },
            { col: 5, value: index === 1 ? 'BPKB ONLY' : 'Lengkap hidup' },
            { col: 6, value: 2029 + index },
            { col: 7, value: 2028 + index },
            { col: 8, value: 15100000 + (index * 250000) },
            { col: 12, value: 12900000 + (index * 150000) },
            { col: 13, value: false },
          ],
        },
        logger,
      ),
    );
  }
  insertMutations.push(
    await createGoogleSheetsMirrorAppendRowMutation(
      config,
      {
        sheetName: 'PENGELUARAN HARIAN',
        cells: [
          { col: 1, value: '12 April 2026' },
          { col: 2, value: expenseDescription },
          { col: 3, value: 7654 },
        ],
      },
      logger,
    ),
  );
  assert.deepEqual(
    insertMutations.map((mutation) => `${mutation.sheetName}:${mutation.targetRow}`),
    [
      `STOK MOTOR:${stokInsertRows[0]}`,
      `STOK MOTOR:${stokInsertRows[1]}`,
      `PENGELUARAN HARIAN:${pengeluaranInsertRow}`,
    ],
  );

  const insertBatch = await applyBatch(config, insertMutations, logger);
  const stokAfterInsert = await readGoogleSheetsMirrorSheet(config, 'STOK MOTOR');
  const pengeluaranAfterInsert = await readGoogleSheetsMirrorSheet(config, 'PENGELUARAN HARIAN');
  const insertLiveRows = await client.readRanges(stokInsertRows.map((row) => `STOK MOTOR!A${row}:M${row}`));
  const insertExpenseRow = await client.readRanges([`PENGELUARAN HARIAN!A${pengeluaranInsertRow}:F${pengeluaranInsertRow}`]);
  const insertSacredStable = await assertStokSacredStable(client, sacredRanges, sacredBefore);
  const insertValidation = await captureValidationForRows(
    config,
    logger,
    validationTargetRows,
    'after_multi_insert',
  );
  assert.equal(insertBatch.mutationCount, 3);
  assert.equal(stokAfterInsert.lastDataRow, stokInsertRows[1]!);
  assert.equal(stokAfterInsert.pendingMutations.length, 0);
  assert.equal(pengeluaranAfterInsert.lastDataRow, pengeluaranInsertRow);
  assert.equal(pengeluaranAfterInsert.pendingMutations.length, 0);
  for (const [index, row] of stokInsertRows.entries()) {
    const name = insertNames[index]!;
    assert.equal(insertLiveRows[index]?.rows[0]?.[1], name);
    assert.equal(insertLiveRows[index]?.rows[0]?.[12], 'FALSE');
    const mirrorRow = stokAfterInsert.valueCells.filter((cell) => cell.row === row);
    assert.equal(mirrorRow.find((cell) => cell.col === 2)?.value, name);
  }
  assert.equal(insertExpenseRow[0]?.rows[0]?.[0], '12 April 2026');
  assert.equal(insertExpenseRow[0]?.rows[0]?.[1], expenseDescription);
  assert.equal(insertExpenseRow[0]?.rows[0]?.[2], 'Rp7.654');
  assert.equal(
    pengeluaranAfterInsert.valueCells.find((cell) => cell.row === pengeluaranInsertRow && cell.col === 2)?.value,
    expenseDescription,
  );

  const editTargetRow = stokExistingRows[0]!;
  const editMutation = await createGoogleSheetsMirrorUpdateCellsMutation(
    config,
    {
      sheetName: 'STOK MOTOR',
      targetRow: editTargetRow,
      cells: [
        { col: 4, value: 'L MULTI EDIT' },
        { col: 5, value: 'BPKB ONLY' },
        { col: 7, value: 2035 },
        { col: 8, value: 16950000 },
        { col: 12, value: 13450000 },
      ],
    },
    logger,
  );
  const editBatch = await applyBatch(config, [editMutation], logger);
  const stokAfterEdit = await readGoogleSheetsMirrorSheet(config, 'STOK MOTOR');
  const editLiveRow = await client.readRanges([`STOK MOTOR!A${editTargetRow}:M${editTargetRow}`]);
  const editSacredStable = await assertStokSacredStable(client, sacredRanges, sacredBefore);
  const editValidation = await captureValidationForRows(
    config,
    logger,
    validationTargetRows,
    'after_multi_edit',
  );
  assert.equal(editBatch.mutationCount, 1);
  assert.equal(editLiveRow[0]?.rows[0]?.[3], 'L MULTI EDIT');
  assert.equal(editLiveRow[0]?.rows[0]?.[4], 'BPKB ONLY');
  assert.equal(editLiveRow[0]?.rows[0]?.[7], 'Rp16.950.000');
  assert.equal(editLiveRow[0]?.rows[0]?.[11], 'Rp13.450.000');
  assert.equal(stokAfterEdit.pendingMutations.length, 0);

  const confirmSoldMutations = [];
  for (const [index, row] of stokExistingRows.entries()) {
    confirmSoldMutations.push(
      await createGoogleSheetsMirrorConfirmSoldMutation(
        config,
        {
          targetRow: row,
          salePrice: 14800000 + (index * 300000),
          soldAt: soldDates[index]!,
        },
        logger,
      ),
    );
  }
  const confirmSoldBatch = await applyBatch(config, confirmSoldMutations, logger);
  const stokAfterConfirmSold = await readGoogleSheetsMirrorSheet(config, 'STOK MOTOR');
  const confirmSoldLiveRows = await client.readRanges(stokExistingRows.map((row) => `STOK MOTOR!A${row}:M${row}`));
  const confirmSoldFormulas = await client.readRangesWithRender(
    stokExistingRows.map((row) => `STOK MOTOR!K${row}:K${row}`),
    'FORMULA',
  );
  const confirmSoldSacredStable = await assertStokSacredStable(client, sacredRanges, sacredBefore);
  const confirmSoldValidation = await captureValidationForRows(
    config,
    logger,
    validationTargetRows,
    'after_multi_confirm_sold',
  );
  assert.equal(confirmSoldBatch.mutationCount, 3);
  assert.equal(stokAfterConfirmSold.pendingMutations.length, 0);
  for (const [index, row] of stokExistingRows.entries()) {
    const soldDate = soldDates[index]!;
    assert.equal(confirmSoldLiveRows[index]?.rows[0]?.[8], formatCurrency(14800000 + (index * 300000)));
    assert.equal(confirmSoldLiveRows[index]?.rows[0]?.[9], soldDate);
    assert.equal(confirmSoldLiveRows[index]?.rows[0]?.[12], 'TRUE');
    assert.ok((confirmSoldFormulas[index]?.rows[0]?.[0] ?? '').toString().startsWith('=IF('));
    const mirrorRow = stokAfterConfirmSold.valueCells.filter((cell) => cell.row === row);
    assert.equal(mirrorRow.find((cell) => cell.col === 13)?.value, 'TRUE');
  }

  const deleteMutations = [
    await createGoogleSheetsMirrorDeleteRowMutation(
      config,
      {
        sheetName: 'STOK MOTOR',
        targetRow: stokInsertRows[0]!,
      },
      logger,
    ),
    await createGoogleSheetsMirrorDeleteRowMutation(
      config,
      {
        sheetName: 'STOK MOTOR',
        targetRow: stokInsertRows[1]!,
      },
      logger,
    ),
    await createGoogleSheetsMirrorDeleteRowMutation(
      config,
      {
        sheetName: 'PENGELUARAN HARIAN',
        targetRow: pengeluaranInsertRow,
      },
      logger,
    ),
  ];
  const deleteBatch = await applyBatch(config, deleteMutations, logger);
  const stokAfterDelete = await readGoogleSheetsMirrorSheet(config, 'STOK MOTOR');
  const pengeluaranAfterDelete = await readGoogleSheetsMirrorSheet(config, 'PENGELUARAN HARIAN');
  const deleteWritableRanges = await client.readRanges(
    stokInsertRows.flatMap((row) => [
      `STOK MOTOR!B${row}:J${row}`,
      `STOK MOTOR!L${row}:M${row}`,
    ]),
  );
  const deleteExpenseRange = await client.readRanges([`PENGELUARAN HARIAN!A${pengeluaranInsertRow}:F${pengeluaranInsertRow}`]);
  const deleteFormulas = await client.readRangesWithRender(
    validationTargetRows.map((row) => `STOK MOTOR!K${row}:K${row}`),
    'FORMULA',
  );
  const deleteSacredStable = await assertStokSacredStable(client, sacredRanges, sacredBefore);
  const deleteValidation = await captureValidationForRows(
    config,
    logger,
    validationTargetRows,
    'after_multi_delete',
  );
  assert.equal(deleteBatch.mutationCount, 3);
  assert.equal(stokAfterDelete.lastDataRow, stokMirrorBefore.lastDataRow);
  assert.equal(stokAfterDelete.pendingMutations.length, 0);
  assert.equal(pengeluaranAfterDelete.lastDataRow, pengeluaranMirrorBefore.lastDataRow);
  assert.equal(pengeluaranAfterDelete.pendingMutations.length, 0);
  for (const row of stokInsertRows) {
    const mirrorRow = stokAfterDelete.valueCells.filter((cell) => cell.row === row);
    assert.deepEqual(mirrorRow, []);
  }
  for (const range of deleteWritableRanges) {
    const row = range.rows[0] ?? [];
    assert.equal(row.every((cell) => cell.trim().length === 0), true);
  }
  assert.equal((deleteExpenseRange[0]?.rows[0] ?? []).every((cell) => cell.trim().length === 0), true);
  for (const entry of deleteFormulas) {
    assert.ok((entry.rows[0]?.[0] ?? '').toString().startsWith('=IF('));
  }
  assert.equal(
    pengeluaranAfterDelete.valueCells.some((cell) => cell.row === pengeluaranInsertRow),
    false,
  );

  const totalAsetAfter = await client.readRangesWithRender(['TOTAL ASET!A1:B20'], 'FORMULA');
  assert.deepEqual(totalAsetAfter, totalAsetBefore);

  console.log(
    JSON.stringify(
      {
        ok: true,
        spreadsheetId: config.googleSheetsSpreadsheetId,
        runtimeStamp,
        stokExistingRows,
        stokInsertRows,
        pengeluaranInsertRow,
        blockedAttempts,
        validationRecovery,
        scenarios: {
          multiInsert: {
            batch: insertBatch,
            liveRows: insertLiveRows,
            liveExpenseRow: insertExpenseRow[0] ?? null,
            mirrorLastDataRow: stokAfterInsert.lastDataRow,
            mirrorRows: stokInsertRows.map((row) => stokAfterInsert.valueCells.filter((cell) => cell.row === row)),
            mirrorExpenseRow: pengeluaranAfterInsert.valueCells.filter((cell) => cell.row === pengeluaranInsertRow),
            sacredStable: insertSacredStable,
            validation: insertValidation,
          },
          multiFieldEdit: {
            batch: editBatch,
            liveRow: editLiveRow[0] ?? null,
            mirrorRow: stokAfterEdit.valueCells.filter((cell) => cell.row === editTargetRow),
            sacredStable: editSacredStable,
            validation: editValidation,
          },
          multiConfirmSold: {
            batch: confirmSoldBatch,
            liveRows: confirmSoldLiveRows,
            formulas: confirmSoldFormulas,
            mirrorRows: stokExistingRows.map((row) =>
              stokAfterConfirmSold.valueCells.filter((cell) => cell.row === row)
            ),
            sacredStable: confirmSoldSacredStable,
            validation: confirmSoldValidation,
          },
          multiDelete: {
            batch: deleteBatch,
            liveWritableRanges: deleteWritableRanges,
            liveExpenseRange: deleteExpenseRange[0] ?? null,
            formulas: deleteFormulas,
            mirrorLastDataRow: stokAfterDelete.lastDataRow,
            mirrorRows: stokInsertRows.map((row) => stokAfterDelete.valueCells.filter((cell) => cell.row === row)),
            mirrorExpenseRow: pengeluaranAfterDelete.valueCells.filter((cell) => cell.row === pengeluaranInsertRow),
            sacredStable: deleteSacredStable,
            validation: deleteValidation,
          },
        },
        sacred: {
          before: sacredBefore,
          totalAsetBefore: totalAsetBefore[0] ?? null,
          totalAsetAfter: totalAsetAfter[0] ?? null,
        },
        validationBefore,
      },
      null,
      2,
    ),
  );
}

async function applyBatch(
  config: ReturnType<typeof loadAppConfig>,
  mutations: Array<{ mutationId: string; sheetName: 'STOK MOTOR' | 'PENGELUARAN HARIAN' | 'TOTAL ASET' }>,
  logger: Logger,
) {
  const refs: GoogleSheetsMirrorBatchMutationRef[] = mutations.map((mutation) => ({
    sheetName: mutation.sheetName,
    mutationId: mutation.mutationId,
  }));
  return applyGoogleSheetsMirrorMutationBatch(config, refs, logger);
}

async function ensureStokValidationRows(
  config: ReturnType<typeof loadAppConfig>,
  logger: Logger,
  targetRows: readonly number[],
) {
  const results: Array<{
    targetRow: number;
    recovered: boolean;
    targetRanges: string[];
    sourceRanges: string[];
  }> = [];

  for (const row of targetRows) {
    const snapshot = await readGoogleSheetsMirrorValidationSnapshot(config, buildStokMotorValidationRanges(row));
    const missingValidation = snapshot.some((entry) => !entry.rows[0]?.[0]?.conditionType);
    if (!missingValidation) {
      results.push({
        targetRow: row,
        recovered: false,
        targetRanges: buildStokMotorValidationRanges(row),
        sourceRanges: buildStokMotorValidationRanges(row + 1),
      });
      continue;
    }

    const recovery = await recoverGoogleSheetsMirrorValidationFromNeighbor(config, row, logger);
    results.push({
      targetRow: row,
      ...recovery,
    });
  }

  return results;
}

async function captureValidationForRows(
  config: ReturnType<typeof loadAppConfig>,
  logger: Logger,
  targetRows: readonly number[],
  stage: string,
) {
  const requestedRanges = targetRows.flatMap((row) => buildStokMotorValidationRanges(row));
  const snapshot = await readGoogleSheetsMirrorValidationSnapshot(config, requestedRanges);
  try {
    assertValidationSnapshot(snapshot, targetRows);
  } catch (error) {
    logger.error('mirror.validation_failed', {
      spreadsheetId: config.googleSheetsSpreadsheetId,
      sheetName: 'STOK MOTOR',
      targetRows,
      stage,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  logger.info('mirror.validation_checked', {
    spreadsheetId: config.googleSheetsSpreadsheetId,
    sheetName: 'STOK MOTOR',
    targetRows,
    stage,
    ranges: snapshot.map((entry) => entry.requestedRange),
  });
  return snapshot;
}

function assertValidationSnapshot(
  snapshot: Awaited<ReturnType<typeof readGoogleSheetsMirrorValidationSnapshot>>,
  targetRows: readonly number[],
): void {
  for (const [index, row] of targetRows.entries()) {
    const suratCell = snapshot[(index * 2)]?.rows[0]?.[0];
    const statusCell = snapshot[(index * 2) + 1]?.rows[0]?.[0];

    if (
      suratCell?.conditionType !== 'ONE_OF_LIST' ||
      suratCell.strict !== true ||
      suratCell.showCustomUi !== true ||
      suratCell.values.join('|') !== 'Lengkap hidup|Lengkap mati|BPKB ONLY'
    ) {
      throw new Error(`STOK MOTOR validation is not intact at E${row}.`);
    }

    if (statusCell?.conditionType !== 'BOOLEAN') {
      throw new Error(`STOK MOTOR validation is not intact at M${row}.`);
    }
  }
}

async function assertStokSacredStable(
  client: Awaited<ReturnType<typeof createGoogleSheetsWriteClient>>,
  sacredRanges: readonly string[],
  expectedSacred: readonly GoogleSheetsTypedRangeSample[],
): Promise<boolean> {
  const sacredAfter = await client.readRangesWithRender(sacredRanges, 'FORMULA');
  assert.deepEqual(sacredAfter, expectedSacred);
  return true;
}

function buildStokSacredRanges(targetRows: readonly number[]): string[] {
  return [
    'STOK MOTOR!A1:M1',
    ...targetRows.flatMap((row) => [
      `STOK MOTOR!A${row}:A${row}`,
      `STOK MOTOR!K${row}:K${row}`,
    ]),
  ];
}

function resolveExistingStokRows(
  sheet: Awaited<ReturnType<typeof readGoogleSheetsMirrorSheet>>,
  count: number,
): number[] {
  const rows = [...new Set(
    sheet.valueCells
      .filter((cell) => cell.row > 1 && cell.col === 2 && String(cell.value).trim().length > 0)
      .map((cell) => cell.row),
  )].sort((left, right) => right - left);

  if (rows.length < count) {
    throw new Error(`STOK MOTOR requires at least ${count} existing active rows for multi confirm sold.`);
  }

  return rows.slice(0, count).sort((left, right) => left - right);
}

function uniqueRows(rows: readonly number[]): number[] {
  return [...new Set(rows)].sort((left, right) => left - right);
}

function formatCurrency(value: number): string {
  return `Rp${value.toLocaleString('id-ID')}`;
}

void main().catch((error) => {
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
});
