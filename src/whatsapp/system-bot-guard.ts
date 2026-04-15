function normalizePhoneNumber(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 0 ? digits : null;
}

function normalizeJid(value: string | null | undefined): string | null {
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

export function listSiblingBotNumbers(botPrimaryNumber: string, superAdminNumbers: readonly string[]): string[] {
  const ownNumber = normalizePhoneNumber(botPrimaryNumber);
  const siblingNumbers = superAdminNumbers
    .map((value) => normalizePhoneNumber(value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .filter((value) => value !== ownNumber);

  return [...new Set(siblingNumbers)];
}

export function isSiblingBotSender(
  normalizedSender: string | null,
  botPrimaryNumber: string,
  superAdminNumbers: readonly string[],
): boolean {
  const senderNumber = normalizePhoneNumber(normalizedSender);
  if (!senderNumber) {
    return false;
  }

  return listSiblingBotNumbers(botPrimaryNumber, superAdminNumbers).includes(senderNumber);
}

export type SystemBotRoutingSkipReason =
  | 'own_external_message'
  | 'secondary_group_runtime'
  | 'sibling_bot_auto_reply';

export function getSystemBotRoutingSkipReason(input: {
  message: unknown;
  normalizedSender: string | null;
  botPrimaryNumber: string;
  superAdminNumbers: readonly string[];
  runtimeProfile: 'primary' | 'secondary';
  isFromSelf: boolean;
  isGroup: boolean;
  chatJid: string | null;
  botJid: string | null;
  botLid: string | null;
}): SystemBotRoutingSkipReason | null {
  if (input.isFromSelf && !isSelfChat(input.chatJid, input.botJid, input.botLid)) {
    return 'own_external_message';
  }

  if (input.isGroup && input.runtimeProfile === 'secondary') {
    return 'secondary_group_runtime';
  }

  if (
    isSiblingBotSender(input.normalizedSender, input.botPrimaryNumber, input.superAdminNumbers) &&
    hasReplyContext(input.message)
  ) {
    return 'sibling_bot_auto_reply';
  }

  return null;
}

function isSelfChat(
  chatJid: string | null,
  botJid: string | null,
  botLid: string | null,
): boolean {
  const normalizedChatJid = normalizeJid(chatJid);
  if (!normalizedChatJid) {
    return false;
  }

  return normalizedChatJid === normalizeJid(botJid) || normalizedChatJid === normalizeJid(botLid);
}

function hasReplyContext(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 6) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const contextInfo = record.contextInfo;
  if (contextInfo && typeof contextInfo === 'object') {
    const context = contextInfo as Record<string, unknown>;
    if (context.quotedMessage || typeof context.stanzaId === 'string') {
      return true;
    }
  }

  return Object.values(record).some((nested) => hasReplyContext(nested, depth + 1));
}
