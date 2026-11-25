import { suspiciousDomainFlag } from "@pochimail/classification/policies/suspicious-rules";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";

/**
 * Ingest runs while the sender's address is in memory, and only here can its domain be read once
 * ADR 0014 drops the address: the flag is stored with the message. A flag the provider already
 * raised is kept.
 */
export function flagSuspicious(message: IncomingMessage): IncomingMessage {
  if (message.suspicious !== undefined) return message;
  const flag = suspiciousDomainFlag(message.from);
  return flag === undefined ? message : { ...message, suspicious: flag };
}
