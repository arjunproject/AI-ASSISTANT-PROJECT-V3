import type { proto } from '@whiskeysockets/baileys';

import type { AiInputMode } from '../ai/types.js';

export interface ExtractedImageMessage {
  imageMessage: proto.Message.IImageMessage;
  inputMode: Extract<AiInputMode, 'image'>;
  mimeType: string | null;
  caption: string | null;
  fileLengthBytes: number | null;
  widthPixels: number | null;
  heightPixels: number | null;
}

export function extractImageMessage(value: unknown, depth = 0): ExtractedImageMessage | null {
  if (!value || typeof value !== 'object' || depth > 5) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directImage = asImageMessage(record.imageMessage);
  if (directImage) {
    return {
      imageMessage: directImage,
      inputMode: 'image',
      mimeType: asNonEmptyString(directImage.mimetype),
      caption: asNonEmptyString(directImage.caption),
      fileLengthBytes: asPositiveNumber(directImage.fileLength),
      widthPixels: asPositiveNumber(directImage.width),
      heightPixels: asPositiveNumber(directImage.height),
    };
  }

  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== 'object') {
      continue;
    }

    const nestedMessage = (nested as Record<string, unknown>).message ?? nested;
    const extracted = extractImageMessage(nestedMessage, depth + 1);
    if (extracted) {
      return extracted;
    }
  }

  return null;
}

function asImageMessage(value: unknown): proto.Message.IImageMessage | null {
  return value && typeof value === 'object' ? (value as proto.Message.IImageMessage) : null;
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
