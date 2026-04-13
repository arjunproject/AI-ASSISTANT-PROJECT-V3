import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  readonly logFilePath: string;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(logFilePath: string): Logger {
  mkdirSync(dirname(logFilePath), { recursive: true });

  return {
    logFilePath,
    info(message, context) {
      writeLog(logFilePath, 'info', message, context);
    },
    warn(message, context) {
      writeLog(logFilePath, 'warn', message, context);
    },
    error(message, context) {
      writeLog(logFilePath, 'error', message, context);
    },
  };
}

function writeLog(
  logFilePath: string,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    pid: process.pid,
    message,
    context: context ?? null,
  };
  const line = `${JSON.stringify(entry, errorSafeReplacer)}\n`;

  appendFileSync(logFilePath, line, 'utf8');

  const consoleLine = `${entry.timestamp} ${level.toUpperCase()} ${message}${
    context ? ` ${JSON.stringify(context, errorSafeReplacer)}` : ''
  }`;
  if (level === 'error') {
    console.error(consoleLine);
    return;
  }
  console.log(consoleLine);
}

function errorSafeReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}
