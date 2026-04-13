import type { WAMessage } from '@whiskeysockets/baileys';

import type {
  IdentityResolutionSource,
  RuntimeIdentityResolutionSnapshot,
} from './types.js';

export interface SenderIdentityContext {
  selfJid: string | null;
  selfLid: string | null;
  botPrimaryNumber: string;
  lidToPn: Map<string, string>;
  pnToLid: Map<string, string>;
}

export function resolveSenderIdentity(
  message: WAMessage,
  context: SenderIdentityContext,
): RuntimeIdentityResolutionSnapshot | null {
  const key = message.key ?? {};
  const rawRemoteJid = asString(key.remoteJid) ?? null;
  const rawRemoteJidAlt = asString(key.remoteJidAlt) ?? null;
  const rawMessageParticipant = asString(message.participant) ?? null;
  const rawKeyParticipant = asString(key.participant) ?? rawMessageParticipant;
  const rawKeyParticipantAlt = asString(key.participantAlt) ?? null;
  const rawContextParticipant = extractContextField(message, 'participant');
  const rawContextRemoteJid = extractContextField(message, 'remoteJid');
  const explicitSenderPn = extractExplicitPhoneNumber(message);
  const chatJid = normalizeJid(
    rawRemoteJid ?? rawRemoteJidAlt ?? rawContextRemoteJid ?? rawKeyParticipant ?? rawMessageParticipant,
  );
  const isGroup = isGroupJid(chatJid);
  const botNumber =
    normalizePhoneNumber(context.botPrimaryNumber) ??
    normalizeJidUser(context.selfJid) ??
    normalizeJidUser(context.selfLid);
  const botJid = normalizeJid(context.selfJid) ?? toPhoneJid(botNumber);
  const botLid = normalizeJid(context.selfLid) ?? toLidJid(botNumber ? context.pnToLid.get(botNumber) ?? null : null);

  const candidates: Array<{ source: IdentityResolutionSource; jid: string | null }> = [];
  if (key.fromMe) {
    candidates.push({
      source: 'self',
      jid: botJid ?? botLid,
    });
  }

  candidates.push(
    { source: 'sender_pn', jid: toPhoneJid(explicitSenderPn) },
    { source: 'participant_alt', jid: rawKeyParticipantAlt },
    { source: 'participant', jid: rawKeyParticipant },
    { source: 'context_participant', jid: rawContextParticipant },
  );

  if (!isGroup) {
    candidates.push(
      { source: 'remote_jid_alt', jid: rawRemoteJidAlt },
      { source: 'context_remote_jid', jid: rawContextRemoteJid },
      { source: 'remote_jid', jid: rawRemoteJid ?? chatJid },
    );
  }

  const selected = candidates.find((candidate) => typeof candidate.jid === 'string' && candidate.jid.length > 0);
  const senderJid = normalizeJid(selected?.jid ?? null);
  if (!senderJid) {
    return null;
  }

  const normalizedSender =
    explicitSenderPn ??
    normalizeSenderNumber(senderJid, context.lidToPn) ??
    (key.fromMe ? botNumber : null);
  const senderPn = normalizedSender;
  const senderLid =
    senderJid.endsWith('@lid')
      ? senderJid
      : toLidJid(normalizedSender ? context.pnToLid.get(normalizedSender) ?? null : null);
  const isFromSelf =
    key.fromMe === true ||
    sameJid(senderJid, botJid) ||
    sameJid(senderJid, botLid) ||
    (normalizedSender !== null && normalizedSender === botNumber);

  return {
    observedAt: new Date().toISOString(),
    chatJid,
    senderJid,
    normalizedSender,
    senderPn,
    senderLid,
    botNumber,
    botJid,
    botLid,
    remoteJid: rawRemoteJid,
    participant: rawMessageParticipant,
    keyParticipant: rawKeyParticipant,
    contextParticipant: rawContextParticipant,
    explicitSenderPn,
    isFromSelf,
    isGroup,
    source: selected?.source ?? 'unknown',
  };
}

function extractExplicitPhoneNumber(message: WAMessage): string | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: message, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 4) {
      continue;
    }

    if (!current.value || typeof current.value !== 'object') {
      continue;
    }

    const record = current.value as Record<string, unknown>;
    const direct =
      normalizePhoneNumber(asString(record.senderPn)) ??
      normalizePhoneNumber(asString(record.sender_pn)) ??
      normalizePhoneNumber(asString(record.participantPn)) ??
      normalizePhoneNumber(asString(record.participant_pn));
    if (direct) {
      return direct;
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        queue.push({
          value,
          depth: current.depth + 1,
        });
      }
    }
  }

  return null;
}

function extractContextField(message: WAMessage, fieldName: 'participant' | 'remoteJid'): string | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: message.message, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 4) {
      continue;
    }

    if (!current.value || typeof current.value !== 'object') {
      continue;
    }

    const record = current.value as Record<string, unknown>;
    const contextInfo = record.contextInfo;
    if (contextInfo && typeof contextInfo === 'object') {
      const value = asString((contextInfo as Record<string, unknown>)[fieldName]);
      if (value) {
        return value;
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        queue.push({
          value,
          depth: current.depth + 1,
        });
      }
    }
  }

  return null;
}

function normalizeSenderNumber(jid: string, lidToPn: Map<string, string>): string | null {
  if (jid.endsWith('@lid')) {
    return normalizePhoneNumber(lidToPn.get(extractBareUser(jid)) ?? null);
  }

  return normalizePhoneNumber(extractBareUser(jid));
}

function normalizeJid(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [userPart, serverPart] = value.split('@', 2);
  if (!userPart || !serverPart) {
    return value;
  }

  const bareUser = userPart.split(':', 1)[0];
  return bareUser ? `${bareUser}@${serverPart}` : value;
}

function normalizeJidUser(value: string | null): string | null {
  return normalizePhoneNumber(value ? extractBareUser(value) : null);
}

function normalizePhoneNumber(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 0 ? digits : null;
}

function toPhoneJid(value: string | null): string | null {
  return value ? `${value}@s.whatsapp.net` : null;
}

function toLidJid(value: string | null): string | null {
  return value ? `${value}@lid` : null;
}

function extractBareUser(jid: string): string {
  return jid.split('@', 1)[0]?.split(':', 1)[0] ?? jid;
}

function isGroupJid(jid: string | null): boolean {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

function sameJid(left: string | null, right: string | null): boolean {
  return normalizeJid(left) !== null && normalizeJid(left) === normalizeJid(right);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
