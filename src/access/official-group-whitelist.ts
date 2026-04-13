import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { OfficialGroupWhitelistRecord } from './types.js';

export interface OfficialGroupWhitelistInspection {
  ready: boolean;
  filePath: string;
  group: OfficialGroupWhitelistRecord | null;
  error: string | null;
}

export async function inspectOfficialGroupWhitelist(
  whitelistFilePath: string,
): Promise<OfficialGroupWhitelistInspection> {
  try {
    await mkdir(dirname(whitelistFilePath), { recursive: true });

    if (!(await fileExists(whitelistFilePath))) {
      throw new Error('Official group whitelist file is missing.');
    }

    const raw = await readFile(whitelistFilePath, 'utf8');
    const parsed = JSON.parse(raw) as { group?: unknown };
    const group = validateOfficialGroupWhitelistRecord(parsed.group);

    return {
      ready: group.isActive,
      filePath: whitelistFilePath,
      group,
      error: group.isActive ? null : 'Official group whitelist is inactive.',
    };
  } catch (error) {
    return {
      ready: false,
      filePath: whitelistFilePath,
      group: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function writeOfficialGroupWhitelist(
  whitelistFilePath: string,
  record: OfficialGroupWhitelistRecord,
): Promise<void> {
  await mkdir(dirname(whitelistFilePath), { recursive: true });
  const payload = {
    group: {
      groupJid: normalizeGroupJid(record.groupJid),
      groupName: normalizeRequiredString(record.groupName),
      inviteLink: normalizeRequiredString(record.inviteLink),
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: normalizeRequiredString(record.source),
    },
  };
  await writeFile(whitelistFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function validateOfficialGroupWhitelistRecord(input: unknown): OfficialGroupWhitelistRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Official group whitelist must contain one group object.');
  }

  const record = input as Record<string, unknown>;
  const groupJid = normalizeGroupJid(asString(record.groupJid));
  const groupName = normalizeRequiredString(asString(record.groupName));
  const inviteLink = normalizeRequiredString(asString(record.inviteLink));
  const isActive = typeof record.isActive === 'boolean' ? record.isActive : null;
  const createdAt = asString(record.createdAt);
  const updatedAt = asString(record.updatedAt);
  const source = normalizeRequiredString(asString(record.source));

  if (!groupJid) {
    throw new Error('Official group whitelist is missing a valid groupJid.');
  }

  if (!groupName || !inviteLink || isActive === null || !createdAt || !updatedAt || !source) {
    throw new Error(`Official group whitelist record ${groupJid} is incomplete.`);
  }

  return {
    groupJid,
    groupName,
    inviteLink,
    isActive,
    createdAt,
    updatedAt,
    source,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeRequiredString(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeGroupJid(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.endsWith('@g.us') ? normalized : null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
