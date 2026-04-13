import type { MessageUpsertType, WAMessage } from '@whiskeysockets/baileys';

import type { Logger } from '../core/logger.js';
import type { RuntimeStateStore } from '../runtime/runtime-state-store.js';
import { extractMessageTextPreview } from './message-text.js';
import type { RuntimeIdentityResolutionSnapshot } from './types.js';

export interface InboundProcessingResult {
  kind: 'received' | 'ignored_non_message' | 'skipped_history' | 'error';
  observedAt: string | null;
}

export interface InboundListener {
  processMessage(
    message: WAMessage,
    upsertType: MessageUpsertType,
    resolution: RuntimeIdentityResolutionSnapshot | null,
  ): Promise<InboundProcessingResult>;
}

export function createInboundMessageListener(dependencies: {
  logger: Logger;
  runtimeStateStore: RuntimeStateStore;
}): InboundListener {
  const { logger, runtimeStateStore } = dependencies;

  return {
    async processMessage(message, upsertType, resolution) {
      if (upsertType === 'append') {
        return {
          kind: 'skipped_history',
          observedAt: null,
        };
      }

      const key = message.key ?? {};
      const observedAt = extractObservedAt(message);
      const messageId = key.id ?? null;
      const chatJid = resolution?.chatJid ?? key.remoteJid ?? null;
      const isFromSelf = resolution?.isFromSelf ?? key.fromMe === true;
      const isGroup = resolution?.isGroup ?? isGroupJid(chatJid);
      const textPreview = extractMessageTextPreview(message.message);

      if (!isUserFacingMessage(message)) {
        logger.info('inbound.ignored_non_message', {
          messageId,
          chatJid,
          senderJid: resolution?.senderJid ?? null,
          normalizedSender: resolution?.normalizedSender ?? null,
          isFromSelf,
          isGroup,
          textPreview,
          messageTimestamp: observedAt,
          resolutionSource: resolution?.source ?? null,
        });
        return {
          kind: 'ignored_non_message',
          observedAt,
        };
      }

      if (!resolution) {
        logger.warn('inbound.error', {
          messageId,
          chatJid,
          senderJid: null,
          normalizedSender: null,
          isFromSelf,
          isGroup,
          textPreview,
          messageTimestamp: observedAt,
          message: 'Inbound identity could not be resolved.',
        });
        return {
          kind: 'error',
          observedAt,
        };
      }

      logger.info('inbound.identity_resolved', {
        messageId,
        chatJid: resolution.chatJid,
        senderJid: resolution.senderJid,
        normalizedSender: resolution.normalizedSender,
        isFromSelf: resolution.isFromSelf,
        isGroup: resolution.isGroup,
        textPreview,
        messageTimestamp: observedAt,
        resolutionSource: resolution.source,
      });

      await runtimeStateStore.update({
        inboundReady: true,
        lastInboundMessageAt: observedAt,
        lastInboundMessageId: messageId,
        lastInboundSender: resolution.senderJid,
        lastInboundNormalizedSender: resolution.normalizedSender,
        lastInboundChatJid: resolution.chatJid,
        lastInboundWasFromSelf: resolution.isFromSelf,
        lastInboundWasGroup: resolution.isGroup,
      });

      logger.info('inbound.received', {
        messageId,
        chatJid: resolution.chatJid,
        senderJid: resolution.senderJid,
        normalizedSender: resolution.normalizedSender,
        isFromSelf: resolution.isFromSelf,
        isGroup: resolution.isGroup,
        textPreview,
        messageTimestamp: observedAt,
        resolutionSource: resolution.source,
      });

      return {
        kind: 'received',
        observedAt,
      };
    },
  };
}

export function isUserFacingMessage(message: WAMessage): boolean {
  return hasUserFacingContent(message.message, 0);
}

function hasUserFacingContent(value: unknown, depth: number): boolean {
  if (!value || typeof value !== 'object' || depth > 4) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] != null);
  for (const key of keys) {
    if (['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'].includes(key)) {
      continue;
    }

    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const nestedMessage = (nested as Record<string, unknown>).message;
      if (nestedMessage && hasUserFacingContent(nestedMessage, depth + 1)) {
        return true;
      }
    }

    if (key !== 'deviceSentMessage') {
      return true;
    }
  }

  return false;
}

function extractObservedAt(message: WAMessage): string {
  const rawTimestamp = message.messageTimestamp;
  if (typeof rawTimestamp === 'number') {
    return new Date(rawTimestamp * 1000).toISOString();
  }

  if (typeof rawTimestamp === 'object' && rawTimestamp !== null && 'toNumber' in rawTimestamp) {
    const numericValue = (rawTimestamp as { toNumber(): number }).toNumber();
    if (Number.isFinite(numericValue)) {
      return new Date(numericValue * 1000).toISOString();
    }
  }

  return new Date().toISOString();
}

function isGroupJid(value: string | null): boolean {
  return typeof value === 'string' && value.endsWith('@g.us');
}
