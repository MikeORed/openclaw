// EventBridge channel plugin shared internal types.

import type { SignalEnvelope } from "./envelope.js";

/**
 * Post-validation resolved form of EventBridge channel config.
 * All fields with defaults are required; truly optional fields stay optional.
 */
export type ResolvedEventBridgeConfig = {
  /** SQS queue URL for inbound event polling. */
  queueUrl: string;
  /** EventBridge bus name for outbound PutEvents. */
  busName?: string;
  /** EventBridge bus ARN for outbound PutEvents. */
  busArn?: string;
  /** Source namespace prefix for outbound events. */
  sourceNamespace: string;
  /** AWS region override (falls back to AWS_REGION / AWS_DEFAULT_REGION). */
  region?: string;
  /** Delay between poll cycles in ms when queue is empty. */
  pollIntervalMs: number;
  /** Max messages per ReceiveMessage call, 1–10. */
  maxMessages: number;
  /** SQS long-poll wait time in seconds, 0–20. */
  waitTimeSeconds: number;
  /** DM policy for ingress filtering. */
  dmPolicy: "open" | "pairing" | "allowlist" | "disabled";
  /** Allowed event sources for ingress filtering. */
  allowFrom?: string[];
};

/** Runtime status snapshot for the EventBridge channel plugin. */
export type EventBridgeRuntimeSnapshot = {
  configured: boolean;
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  lastError: string | null;
};

/** Parsed SQS message ready for inbound processing. */
export type PollResult = {
  messageId: string;
  receiptHandle: string;
  body: unknown;
  approximateReceiveCount: number;
};

/** Context for a validated inbound event being processed. */
export type InboundEventContext = {
  envelope: SignalEnvelope;
  sqsMessageId: string;
  receiptHandle: string;
};
