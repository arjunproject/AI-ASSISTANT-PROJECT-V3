import { access } from 'node:fs/promises';

import type { AppConfig } from './app-config.js';

export interface GoogleSheetsConfigInspection {
  ready: boolean;
  spreadsheetId: string | null;
  serviceAccountEmail: string | null;
  serviceAccountKeyPath: string | null;
  error: string | null;
}

export async function inspectGoogleSheetsConfig(
  config: AppConfig,
): Promise<GoogleSheetsConfigInspection> {
  if (!config.spreadsheetReadEnabled && !config.mirrorSyncEnabled) {
    return {
      ready: false,
      spreadsheetId: null,
      serviceAccountEmail: null,
      serviceAccountKeyPath: null,
      error: null,
    };
  }

  const spreadsheetId = config.googleSheetsSpreadsheetId;
  const serviceAccountEmail = config.googleServiceAccountEmail;
  const serviceAccountKeyPath = config.googleServiceAccountKeyPath;

  if (!spreadsheetId) {
    return {
      ready: false,
      spreadsheetId,
      serviceAccountEmail,
      serviceAccountKeyPath,
      error: 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.',
    };
  }

  if (!serviceAccountEmail) {
    return {
      ready: false,
      spreadsheetId,
      serviceAccountEmail,
      serviceAccountKeyPath,
      error: 'GOOGLE_SERVICE_ACCOUNT_EMAIL is missing.',
    };
  }

  if (!serviceAccountKeyPath) {
    return {
      ready: false,
      spreadsheetId,
      serviceAccountEmail,
      serviceAccountKeyPath,
      error: 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH is missing.',
    };
  }

  try {
    await access(serviceAccountKeyPath);
  } catch {
    return {
      ready: false,
      spreadsheetId,
      serviceAccountEmail,
      serviceAccountKeyPath,
      error: `GOOGLE_SERVICE_ACCOUNT_KEY_PATH does not exist: ${serviceAccountKeyPath}`,
    };
  }

  return {
    ready: true,
    spreadsheetId,
    serviceAccountEmail,
    serviceAccountKeyPath,
    error: null,
  };
}
