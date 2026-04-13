import type { proto } from '@whiskeysockets/baileys';

import type { AiInputMode } from '../ai/types.js';

export interface ExtractedAudioMessage {
  audioMessage: proto.Message.IAudioMessage;
  inputMode: Extract<AiInputMode, 'voice_note' | 'audio'>;
  mimeType: string | null;
  durationSeconds: number | null;
  fileLengthBytes: number | null;
}

export function extractAudioMessage(value: unknown, depth = 0): ExtractedAudioMessage | null {
  if (!value || typeof value !== 'object' || depth > 5) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directAudio = asAudioMessage(record.audioMessage);
  if (directAudio) {
    return {
      audioMessage: directAudio,
      inputMode: directAudio.ptt === true ? 'voice_note' : 'audio',
      mimeType: asNonEmptyString(directAudio.mimetype),
      durationSeconds: asPositiveNumber(directAudio.seconds),
      fileLengthBytes: asPositiveNumber(directAudio.fileLength),
    };
  }

  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== 'object') {
      continue;
    }

    const nestedMessage = (nested as Record<string, unknown>).message ?? nested;
    const extracted = extractAudioMessage(nestedMessage, depth + 1);
    if (extracted) {
      return extracted;
    }
  }

  return null;
}

function asAudioMessage(value: unknown): proto.Message.IAudioMessage | null {
  return value && typeof value === 'object' ? (value as proto.Message.IAudioMessage) : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'bigint' && value > 0n) {
    return Number(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (value && typeof value === 'object') {
    const maybeToNumber = (value as { toNumber?: () => number }).toNumber;
    if (typeof maybeToNumber === 'function') {
      const converted = maybeToNumber.call(value);
      return Number.isFinite(converted) && converted > 0 ? converted : null;
    }
  }

  return null;
}
