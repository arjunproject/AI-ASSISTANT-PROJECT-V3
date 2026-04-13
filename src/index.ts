import { loadAppConfig } from './config/app-config.js';
import { collectHealthReport } from './core/health-service.js';
import { createLogger } from './core/logger.js';
import { ProcessLockConflictError, ProcessLockMalformedError } from './core/process-lock.js';
import { startRuntime } from './runtime/runtime-service.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';
  const config = loadAppConfig();

  if (command === 'health') {
    const report = await collectHealthReport(config);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === 'start') {
    const runtime = await startRuntime(config);
    await runtime.untilStopped;
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

void main().catch((error: unknown) => {
  const config = loadAppConfig();
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof ProcessLockConflictError || error instanceof ProcessLockMalformedError) {
    console.error(message);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config.logFilePath);
  logger.error('runtime.error', {
    command: process.argv[2] ?? 'start',
    message,
    error,
  });
  console.error(message);
  process.exitCode = 1;
});
