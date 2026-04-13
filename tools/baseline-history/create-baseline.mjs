import { resolve, join } from 'node:path';

import {
  BASELINE_SNAPSHOTS_ROOT,
  EXCLUDED_RUNTIME_PATHS,
  MANAGED_ENTRIES,
  buildBaselineId,
  captureGitMetadata,
  captureHealthReport,
  createFileInventory,
  ensureDirectory,
  formatConsoleJson,
  parseCliArgs,
  pathExists,
  readBaselineIndex,
  resolveProjectRoot,
  snapshotManagedEntry,
  writeBaselineIndex,
  writeJson,
} from './shared.mjs';

async function main() {
  const projectRoot = resolveProjectRoot();
  const args = parseCliArgs(process.argv.slice(2));
  const label = args.label ?? args.positional[0] ?? 'stable-baseline';
  const baselineId = buildBaselineId(label);
  const snapshotRoot = resolve(projectRoot, BASELINE_SNAPSHOTS_ROOT, baselineId);
  const snapshotFilesRoot = join(snapshotRoot, 'files');
  const evidenceRoot = join(snapshotRoot, 'evidence');

  if (await pathExists(snapshotRoot)) {
    throw new Error(`Baseline snapshot already exists: ${baselineId}`);
  }

  await ensureDirectory(snapshotFilesRoot);
  await ensureDirectory(evidenceRoot);

  const managedEntries = [];
  for (const entry of MANAGED_ENTRIES) {
    managedEntries.push(await snapshotManagedEntry(projectRoot, snapshotFilesRoot, entry));
  }

  const fileInventory = await createFileInventory(snapshotFilesRoot);
  const git = await captureGitMetadata(projectRoot);
  const healthCapture = await captureHealthReport(projectRoot);

  if (healthCapture.ok && healthCapture.report) {
    await writeJson(join(evidenceRoot, 'health-report.json'), healthCapture.report);
  } else {
    await writeJson(join(evidenceRoot, 'health-capture.json'), {
      ok: healthCapture.ok,
      exitCode: healthCapture.exitCode,
      stdout: healthCapture.stdout,
      stderr: healthCapture.stderr,
    });
  }

  await writeJson(join(evidenceRoot, 'git-metadata.json'), git);

  const manifest = {
    version: 1,
    baselineId,
    label,
    note: args.note ?? null,
    createdAt: new Date().toISOString(),
    projectRoot,
    git,
    managedEntries,
    excludedRuntimePaths: EXCLUDED_RUNTIME_PATHS,
    fileInventory,
    evidence: {
      healthPath: healthCapture.ok ? 'evidence/health-report.json' : 'evidence/health-capture.json',
      gitMetadataPath: 'evidence/git-metadata.json',
    },
  };

  await writeJson(join(snapshotRoot, 'manifest.json'), manifest);

  const index = await readBaselineIndex(projectRoot);
  index.currentStableBaselineId = baselineId;
  index.baselines = [
    ...index.baselines.filter((entry) => entry.id !== baselineId),
    {
      id: baselineId,
      label,
      createdAt: manifest.createdAt,
      gitHead: git.head,
      healthOverallStatus: healthCapture.report?.overallStatus ?? null,
      manifestPath: `${BASELINE_SNAPSHOTS_ROOT.replace(/\\/g, '/')}/${baselineId}/manifest.json`,
    },
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  await writeBaselineIndex(projectRoot, index);

  console.log(
    formatConsoleJson({
      ok: true,
      baselineId,
      label,
      snapshotRoot: snapshotRoot.replace(/\\/g, '/'),
      healthOverallStatus: healthCapture.report?.overallStatus ?? null,
      managedPathCount: managedEntries.length,
      capturedFileCount: fileInventory.length,
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
