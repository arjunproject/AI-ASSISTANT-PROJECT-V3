import { dirname, join, resolve } from 'node:path';

import {
  BASELINE_SNAPSHOTS_ROOT,
  LAST_RESTORE_PATH,
  copyManagedPath,
  ensureDirectory,
  formatConsoleJson,
  parseCliArgs,
  pathExists,
  readBaselineIndex,
  readJsonIfExists,
  removeManagedPath,
  resolveManagedPaths,
  resolveProjectRoot,
  writeJson,
} from './shared.mjs';

async function main() {
  const projectRoot = resolveProjectRoot();
  const args = parseCliArgs(process.argv.slice(2));
  const index = await readBaselineIndex(projectRoot);
  const requestedId = args.id ?? args.positional[0] ?? (args.latest ? null : index.currentStableBaselineId);
  const baselineId = requestedId ?? index.baselines[index.baselines.length - 1]?.id ?? null;

  if (!baselineId) {
    throw new Error('No baseline snapshot is available to restore.');
  }

  const snapshotRoot = resolve(projectRoot, BASELINE_SNAPSHOTS_ROOT, baselineId);
  const manifestPath = join(snapshotRoot, 'manifest.json');
  const manifest = await readJsonIfExists(manifestPath, null);

  if (!manifest) {
    throw new Error(`Baseline manifest was not found: ${manifestPath}`);
  }

  const actions = [];

  for (const entry of manifest.managedEntries) {
    const { targetPath } = resolveManagedPaths(projectRoot, entry);
    const snapshotPath = resolve(snapshotRoot, 'files', entry.path);
    const snapshotExists = entry.exists && (await pathExists(snapshotPath));

    actions.push({
      path: entry.path,
      kind: entry.kind,
      existsInBaseline: entry.exists,
      action: entry.exists ? 'restore' : 'remove',
    });

    if (args.dryRun) {
      continue;
    }

    await removeManagedPath(projectRoot, entry, false);

    if (snapshotExists) {
      await ensureDirectory(dirname(targetPath));
      await copyManagedPath(snapshotPath, targetPath, entry.kind, false);
    }
  }

  if (!args.dryRun) {
    await writeJson(resolve(projectRoot, LAST_RESTORE_PATH), {
      baselineId,
      restoredAt: new Date().toISOString(),
      actionCount: actions.length,
    });
  }

  console.log(
    formatConsoleJson({
      ok: true,
      baselineId,
      dryRun: args.dryRun,
      actionCount: actions.length,
      actions,
    }),
  );
}

void main().catch((error) => {
  console.error(
    formatConsoleJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
