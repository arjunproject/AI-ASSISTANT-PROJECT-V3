import { formatConsoleJson, readBaselineIndex, resolveProjectRoot } from './shared.mjs';

async function main() {
  const projectRoot = resolveProjectRoot();
  const index = await readBaselineIndex(projectRoot);
  const currentId = index.currentStableBaselineId;

  const baselines = index.baselines.map((entry) => ({
    ...entry,
    isCurrentStable: entry.id === currentId,
  }));

  console.log(
    formatConsoleJson({
      ok: true,
      currentStableBaselineId: currentId,
      baselineCount: baselines.length,
      baselines,
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
