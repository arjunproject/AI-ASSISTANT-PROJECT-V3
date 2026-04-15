import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppConfig } from '../config/app-config.js';
import type { Logger } from '../core/logger.js';
import { listSiblingBotNumbers } from '../whatsapp/system-bot-guard.js';

const OUTBOX_DIR = 'test-outbox';
const PENDING_DIR = 'pending';
const PROCESSING_DIR = 'processing';
const SENT_DIR = 'sent';
const FAILED_DIR = 'failed';
const TEST_OUTBOX_POLL_INTERVAL_MS = 1_000;
const MAX_TEST_MESSAGE_LENGTH = 2_000;

export interface RuntimeTestOutboxRequest {
  id: string;
  createdAt: string;
  source: 'cli';
  target: 'bot1';
  targetJid: string;
  text: string;
}

export interface RuntimeTestOutboxEnqueueResult {
  id: string;
  filePath: string;
  targetJid: string;
}

export interface RuntimeTestOutboxController {
  stop(): Promise<void>;
}

export async function enqueueRuntimeTestMessage(
  config: AppConfig,
  input: {
    target: string;
    text: string;
  },
): Promise<RuntimeTestOutboxEnqueueResult> {
  if (config.runtimeProfile !== 'secondary') {
    throw new Error('test-send is only enabled for bot2/secondary runtime.');
  }

  const text = normalizeTestMessageText(input.text);
  const targetJid = resolveRuntimeTestTargetJid(config, input.target);
  const id = `${formatQueueTimestamp(new Date())}-${randomUUID()}`;
  const pendingDir = getOutboxPath(config, PENDING_DIR);
  await mkdir(pendingDir, { recursive: true });

  const request: RuntimeTestOutboxRequest = {
    id,
    createdAt: new Date().toISOString(),
    source: 'cli',
    target: 'bot1',
    targetJid,
    text,
  };
  const finalPath = join(pendingDir, `${id}.json`);
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
  await rename(tempPath, finalPath);

  return {
    id,
    filePath: finalPath,
    targetJid,
  };
}

export function startRuntimeTestOutbox(input: {
  config: AppConfig;
  logger: Logger;
  sendText(targetJid: string, text: string, request: RuntimeTestOutboxRequest): Promise<{
    messageId: string | null;
  }>;
}): RuntimeTestOutboxController {
  const { config, logger, sendText } = input;

  if (config.runtimeProfile !== 'secondary') {
    return {
      async stop() {
        return undefined;
      },
    };
  }

  let stopped = false;
  let active = false;
  const timer = setInterval(() => {
    void processPendingRequests();
  }, TEST_OUTBOX_POLL_INTERVAL_MS);

  void recoverProcessingRequests()
    .then(processPendingRequests)
    .catch((error: unknown) => {
      logger.warn('test_outbox.recover_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

  logger.info('test_outbox.started', {
    pendingDir: getOutboxPath(config, PENDING_DIR),
  });

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (active) {
        await waitForIdle();
      }
    },
  };

  async function processPendingRequests(): Promise<void> {
    if (stopped || active) {
      return;
    }

    active = true;
    try {
      await mkdir(getOutboxPath(config, PENDING_DIR), { recursive: true });
      await mkdir(getOutboxPath(config, PROCESSING_DIR), { recursive: true });
      await mkdir(getOutboxPath(config, SENT_DIR), { recursive: true });
      await mkdir(getOutboxPath(config, FAILED_DIR), { recursive: true });

      const files = (await readdir(getOutboxPath(config, PENDING_DIR)))
        .filter((fileName) => fileName.endsWith('.json'))
        .sort();

      for (const fileName of files) {
        if (stopped) {
          return;
        }
        await processOneRequest(fileName);
      }
    } finally {
      active = false;
    }
  }

  async function processOneRequest(fileName: string): Promise<void> {
    const pendingPath = join(getOutboxPath(config, PENDING_DIR), fileName);
    const processingPath = join(getOutboxPath(config, PROCESSING_DIR), fileName);

    try {
      await rename(pendingPath, processingPath);
    } catch {
      return;
    }

    try {
      const request = parseRuntimeTestOutboxRequest(await readFile(processingPath, 'utf8'));
      validateRuntimeTestOutboxRequest(config, request);
      const result = await sendText(request.targetJid, request.text, request);
      const sentPath = join(getOutboxPath(config, SENT_DIR), fileName);
      await writeFile(
        sentPath,
        `${JSON.stringify(
          {
            ...request,
            status: 'sent',
            sentAt: new Date().toISOString(),
            messageId: result.messageId,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await unlink(processingPath);
      logger.info('test_outbox.sent', {
        requestId: request.id,
        target: request.target,
        targetJid: request.targetJid,
        messageId: result.messageId,
      });
    } catch (error) {
      const failedPath = join(getOutboxPath(config, FAILED_DIR), fileName);
      const message = error instanceof Error ? error.message : String(error);
      const rawRequest = await readFile(processingPath, 'utf8').catch(() => '');
      await writeFile(
        failedPath,
        `${JSON.stringify(
          {
            status: 'failed',
            failedAt: new Date().toISOString(),
            error: message,
            rawRequest,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await unlink(processingPath).catch(() => undefined);
      logger.warn('test_outbox.failed', {
        fileName,
        message,
      });
    }
  }

  async function recoverProcessingRequests(): Promise<void> {
    await mkdir(getOutboxPath(config, PENDING_DIR), { recursive: true });
    await mkdir(getOutboxPath(config, PROCESSING_DIR), { recursive: true });

    const files = (await readdir(getOutboxPath(config, PROCESSING_DIR)))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort();

    for (const fileName of files) {
      await rename(
        join(getOutboxPath(config, PROCESSING_DIR), fileName),
        join(getOutboxPath(config, PENDING_DIR), fileName),
      ).catch(() => undefined);
    }
  }

  async function waitForIdle(): Promise<void> {
    for (let attempt = 0; attempt < 20 && active; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export function resolveRuntimeTestTargetJid(config: AppConfig, target: string): string {
  const normalizedTarget = target.trim().toLowerCase();
  if (normalizedTarget !== 'bot1') {
    throw new Error('Only target "bot1" is supported for bot2 test-send.');
  }

  const targetNumber = listSiblingBotNumbers(config.botPrimaryNumber, config.superAdminNumbers)[0];
  if (!targetNumber) {
    throw new Error('Cannot resolve bot1 number from paired bot configuration.');
  }

  return `${targetNumber}@s.whatsapp.net`;
}

function validateRuntimeTestOutboxRequest(config: AppConfig, request: RuntimeTestOutboxRequest): void {
  const expectedTargetJid = resolveRuntimeTestTargetJid(config, request.target);
  if (request.targetJid !== expectedTargetJid) {
    throw new Error('Rejected test-send request because targetJid does not match bot1.');
  }
  normalizeTestMessageText(request.text);
}

function parseRuntimeTestOutboxRequest(raw: string): RuntimeTestOutboxRequest {
  const parsed = JSON.parse(raw) as Partial<RuntimeTestOutboxRequest>;
  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.createdAt !== 'string' ||
    parsed.source !== 'cli' ||
    parsed.target !== 'bot1' ||
    typeof parsed.targetJid !== 'string' ||
    typeof parsed.text !== 'string'
  ) {
    throw new Error('Invalid test-send outbox request.');
  }

  return {
    id: parsed.id,
    createdAt: parsed.createdAt,
    source: parsed.source,
    target: parsed.target,
    targetJid: parsed.targetJid,
    text: parsed.text,
  };
}

function normalizeTestMessageText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error('test-send message text cannot be empty.');
  }
  if (normalized.length > MAX_TEST_MESSAGE_LENGTH) {
    throw new Error(`test-send message text cannot exceed ${MAX_TEST_MESSAGE_LENGTH} characters.`);
  }

  return normalized;
}

function getOutboxPath(config: AppConfig, child: string): string {
  return join(config.runtimeRoot, OUTBOX_DIR, child);
}

function formatQueueTimestamp(date: Date): string {
  return date.toISOString().replace(/[^\d]/gu, '').slice(0, 17);
}
