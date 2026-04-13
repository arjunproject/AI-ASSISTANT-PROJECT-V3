import { existsSync, readFileSync } from 'node:fs';

const loadedEnvFiles = new Set<string>();

export function loadEnvFile(envFilePath: string): void {
  if (loadedEnvFiles.has(envFilePath)) {
    return;
  }

  loadedEnvFiles.add(envFilePath);
  if (!existsSync(envFilePath)) {
    return;
  }

  const raw = readFileSync(envFilePath, 'utf8');
  const lines = raw.split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = unquoteEnvValue(rawValue);
    if (!key) {
      continue;
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
