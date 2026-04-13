import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { useMultiFileAuthState } from '@whiskeysockets/baileys';

export interface SessionStoreInspection {
  ready: boolean;
  present: boolean;
  credsFilePath: string;
  error: string | null;
}

export interface StoredLidMappings {
  lidToPn: Map<string, string>;
  pnToLid: Map<string, string>;
}

export async function inspectSessionStore(authDir: string): Promise<SessionStoreInspection> {
  const credsFilePath = join(authDir, 'creds.json');

  try {
    await mkdir(authDir, { recursive: true });
    await access(authDir, constants.R_OK | constants.W_OK);

    const present = await fileExists(credsFilePath);
    if (present) {
      const rawCreds = await readFile(credsFilePath, 'utf8');
      JSON.parse(rawCreds);
    }

    return {
      ready: true,
      present,
      credsFilePath,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      present: await fileExists(credsFilePath),
      credsFilePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadSessionAuthState(authDir: string) {
  await mkdir(authDir, { recursive: true });
  return useMultiFileAuthState(authDir);
}

export async function loadStoredLidMappings(authDir: string): Promise<StoredLidMappings> {
  const lidToPn = new Map<string, string>();
  const pnToLid = new Map<string, string>();

  try {
    const entries = await readdir(authDir);
    for (const entry of entries) {
      const match = /^lid-mapping-(.+?)(?:_reverse)?\.json$/u.exec(entry);
      if (!match) {
        continue;
      }

      const rawValue = await readFile(join(authDir, entry), 'utf8');
      const parsed = JSON.parse(rawValue) as string;
      if (typeof parsed !== 'string' || parsed.length === 0) {
        continue;
      }

      const key = match[1];
      if (!key) {
        continue;
      }

      if (entry.includes('_reverse')) {
        lidToPn.set(key, parsed);
        pnToLid.set(parsed, key);
      } else {
        pnToLid.set(key, parsed);
        lidToPn.set(parsed, key);
      }
    }
  } catch {
    return {
      lidToPn,
      pnToLid,
    };
  }

  return {
    lidToPn,
    pnToLid,
  };
}

export async function clearSessionStore(authDir: string): Promise<void> {
  await rm(authDir, { recursive: true, force: true });
  await mkdir(authDir, { recursive: true });
}

export async function seedSessionCreds(authDir: string, contents: Record<string, unknown>): Promise<void> {
  await mkdir(authDir, { recursive: true });
  await writeFile(join(authDir, 'creds.json'), `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
