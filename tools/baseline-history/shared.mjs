import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export const BASELINE_HISTORY_ROOT = '.baseline-history';
export const BASELINE_SNAPSHOTS_ROOT = join(BASELINE_HISTORY_ROOT, 'snapshots');
export const BASELINE_INDEX_PATH = join(BASELINE_HISTORY_ROOT, 'index.json');
export const LAST_RESTORE_PATH = join(BASELINE_HISTORY_ROOT, 'last-restore.json');

export const MANAGED_ENTRIES = [
  { path: 'src', kind: 'directory', required: true, reason: 'Core application source.' },
  { path: 'tests', kind: 'directory', required: true, reason: 'Regression and contract tests.' },
  { path: 'dist', kind: 'directory', required: true, reason: 'Known-good build artifacts for fast restore.' },
  { path: 'package.json', kind: 'file', required: true, reason: 'Scripts and dependency manifest.' },
  { path: 'package-lock.json', kind: 'file', required: true, reason: 'Locked dependency graph.' },
  { path: 'tsconfig.json', kind: 'file', required: true, reason: 'TypeScript build contract.' },
  { path: '.gitignore', kind: 'file', required: true, reason: 'Workspace ignore rules.' },
  { path: '.env', kind: 'file', required: false, reason: 'Local runtime configuration and secrets.' },
  { path: '.env.example', kind: 'file', required: false, reason: 'Environment template.' },
  { path: '.runtime/access', kind: 'directory', required: false, reason: 'Dynamic admin and whitelist runtime config.' },
  { path: '.runtime/ai', kind: 'directory', required: false, reason: 'Dynamic prompt runtime config.' },
  { path: 'tools/baseline-history', kind: 'directory', required: true, reason: 'Local baseline history tooling.' },
] ;

export const EXCLUDED_RUNTIME_PATHS = [
  '.runtime/logs',
  '.runtime/status',
  '.runtime/lock',
  '.runtime/mirror',
  '.runtime/whatsapp',
  '.runtime/*.png',
  '.runtime/*.log',
  '.runtime/*.ps1',
];

export async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function resolveProjectRoot(cwd = process.cwd()) {
  return resolve(cwd);
}

export function sanitizeLabel(label) {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.length > 0 ? normalized : 'baseline';
}

export function buildBaselineId(label, now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-')
    .replace('Z', '');

  return `${stamp}-${sanitizeLabel(label)}`;
}

export async function readJsonIfExists(path, fallback) {
  if (!(await pathExists(path))) {
    return fallback;
  }

  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(path, value) {
  await ensureDirectory(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readBaselineIndex(projectRoot) {
  return readJsonIfExists(resolve(projectRoot, BASELINE_INDEX_PATH), {
    version: 1,
    currentStableBaselineId: null,
    baselines: [],
  });
}

export async function writeBaselineIndex(projectRoot, index) {
  await writeJson(resolve(projectRoot, BASELINE_INDEX_PATH), index);
}

export function parseCliArgs(argv) {
  const options = {
    positional: [],
    label: null,
    note: null,
    id: null,
    dryRun: false,
    latest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--label') {
      options.label = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === '--note') {
      options.note = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === '--id') {
      options.id = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token === '--latest') {
      options.latest = true;
      continue;
    }

    options.positional.push(token);
  }

  return options;
}

export function resolveManagedPaths(projectRoot, entry) {
  const targetPath = resolve(projectRoot, entry.path);
  const relativePath = relative(projectRoot, targetPath);
  if (relativePath.startsWith('..')) {
    throw new Error(`Managed path escapes project root: ${entry.path}`);
  }
  return {
    targetPath,
    relativePath: entry.path.replace(/\\/g, '/'),
  };
}

export async function removeManagedPath(projectRoot, entry, dryRun = false) {
  const { targetPath } = resolveManagedPaths(projectRoot, entry);
  if (dryRun) {
    return;
  }
  await rm(targetPath, { recursive: true, force: true });
}

export async function copyManagedPath(sourcePath, targetPath, kind, dryRun = false) {
  if (dryRun) {
    return;
  }

  await ensureDirectory(dirname(targetPath));

  if (kind === 'directory') {
    await cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
    return;
  }

  await cp(sourcePath, targetPath, {
    force: true,
    preserveTimestamps: true,
  });
}

export async function listFilesRecursively(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      results.push(absolutePath);
    }
  }

  return results;
}

export async function createFileInventory(rootPath) {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const files = await listFilesRecursively(rootPath);
  const inventory = [];

  for (const file of files.sort()) {
    const fileStat = await stat(file);
    const content = await readFile(file);
    const sha256 = createHash('sha256').update(content).digest('hex');
    inventory.push({
      path: relative(rootPath, file).replace(/\\/g, '/'),
      size: fileStat.size,
      sha256,
    });
  }

  return inventory;
}

export async function runCommand(command, args, projectRoot) {
  return new Promise((resolvePromise) => {
    const useShell = process.platform === 'win32';
    const executable = useShell
      ? [command, ...args].map(quoteShellToken).join(' ')
      : command;
    const child = spawn(executable, useShell ? [] : args, {
      cwd: projectRoot,
      shell: useShell,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.on('error', (error) => {
      resolvePromise({
        code: -1,
        stdout,
        stderr: `${stderr}${error instanceof Error ? error.message : String(error)}`,
      });
    });

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function quoteShellToken(token) {
  if (/^[A-Za-z0-9_./:-]+$/.test(token)) {
    return token;
  }

  return `"${String(token).replace(/"/g, '\\"')}"`;
}

export async function captureGitMetadata(projectRoot) {
  const head = await runCommand('git', ['rev-parse', 'HEAD'], projectRoot);
  const summary = await runCommand('git', ['log', '-1', '--oneline'], projectRoot);
  const status = await runCommand('git', ['status', '--short'], projectRoot);

  return {
    head: head.code === 0 ? head.stdout.trim() : null,
    summary: summary.code === 0 ? summary.stdout.trim() : null,
    statusShort: status.code === 0 ? status.stdout.trimEnd() : '',
    statusCode: status.code,
  };
}

export async function captureHealthReport(projectRoot) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = await runCommand(npmCommand, ['run', 'health', '--silent'], projectRoot);

  if (result.code !== 0) {
    return {
      ok: false,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      report: null,
    };
  }

  try {
    return {
      ok: true,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      report: JSON.parse(result.stdout),
    };
  } catch {
    return {
      ok: false,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      report: null,
    };
  }
}

export async function snapshotManagedEntry(projectRoot, snapshotFilesRoot, entry) {
  const { targetPath, relativePath } = resolveManagedPaths(projectRoot, entry);
  const exists = await pathExists(targetPath);
  const snapshotPath = resolve(snapshotFilesRoot, entry.path);

  if (!exists) {
    if (entry.required) {
      throw new Error(`Required managed path is missing: ${entry.path}`);
    }

    return {
      ...entry,
      exists: false,
      fileCount: 0,
      snapshotPath: relativePath,
    };
  }

  await copyManagedPath(targetPath, snapshotPath, entry.kind, false);

  const fileCount =
    entry.kind === 'directory'
      ? (await listFilesRecursively(snapshotPath)).length
      : 1;

  return {
    ...entry,
    exists: true,
    fileCount,
    snapshotPath: relativePath,
  };
}

export function formatConsoleJson(value) {
  return JSON.stringify(value, null, 2);
}
