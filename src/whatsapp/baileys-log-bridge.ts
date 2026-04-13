import { Writable } from 'node:stream';

import pino from 'pino';

export interface BaileysDiagnosticEntry {
  level: number;
  msg: string;
  data: Record<string, unknown>;
}

export function createBaileysDiagnosticLogger(
  onEntry: (entry: BaileysDiagnosticEntry) => void,
) {
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      try {
        const line = chunk.toString().trim();
        if (line.length === 0) {
          callback();
          return;
        }

        const parsed = JSON.parse(line) as Record<string, unknown>;
        onEntry({
          level: typeof parsed.level === 'number' ? parsed.level : 30,
          msg: typeof parsed.msg === 'string' ? parsed.msg : '',
          data: parsed,
        });
      } catch {
        callback();
        return;
      }

      callback();
    },
  });

  return pino(
    {
      base: undefined,
      level: 'debug',
      timestamp: false,
    },
    destination,
  );
}
