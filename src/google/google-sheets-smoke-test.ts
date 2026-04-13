import { loadAppConfig } from '../config/app-config.js';
import {
  createGoogleSheetsReadClient,
  GOOGLE_SHEETS_SMOKE_TEST_RANGES,
} from './google-sheets-client.js';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const client = await createGoogleSheetsReadClient(config);
  const inspection = client.inspect();
  const auth = await client.authenticate();
  const metadata = await client.readSpreadsheetMetadata();
  const ranges = await client.readRanges(GOOGLE_SHEETS_SMOKE_TEST_RANGES);

  console.log(
    JSON.stringify(
      {
        ok: true,
        readAt: new Date().toISOString(),
        auth: {
          serviceAccountEmail: auth.serviceAccountEmail,
          spreadsheetId: auth.spreadsheetId,
          accessTokenPresent: auth.accessTokenPresent,
          projectId: inspection.projectId,
        },
        metadata,
        ranges,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
