import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createTempRoot(prefix: string): Promise<{
  root: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return {
    root,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function seedPackageJson(root: string): Promise<void> {
  const packageJsonPath = join(root, 'package.json');
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: 'temp-stage-0',
        scripts: {
          build: 'tsc -p tsconfig.json',
          typecheck: 'tsc -p tsconfig.json --noEmit',
          start: 'node dist/src/index.js start',
          health: 'node dist/src/index.js health',
          test: 'node --test',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export async function seedBuildArtifact(root: string): Promise<void> {
  const buildPath = join(root, 'dist', 'src');
  await mkdir(buildPath, { recursive: true });
  await writeFile(join(buildPath, 'index.js'), 'console.log("built");\n', 'utf8');
}

export async function seedRuntimeState(
  root: string,
  payload: unknown,
): Promise<void> {
  const statePath = join(root, '.runtime', 'status');
  await mkdir(statePath, { recursive: true });
  await writeFile(join(statePath, 'runtime-state.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}
