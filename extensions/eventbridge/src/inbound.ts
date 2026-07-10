// EventBridge channel plugin inbound processing module.
// Parses SQS message bodies as EventBridge events, validates Signal Envelopes,
// resolves ingress access control, and delivers authorized events to the agent.

import type { SQSClient } from "@aws-sdk/client-sqs";
import {
  createChannelIngressResolver,
  defineStableChannelIngressIdentity,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { parseInboundEnvelope } from "./envelope.js";
import { deleteMessage } from "./poller.js";
import type { InboundEventContext, PollResult, ResolvedEventBridgeConfig } from "./types.js";

const CHANNEL_ID = "eventbridge" as const;

/**
 * Stable ingress identity for EventBridge inbound events.
 * Uses the Signal Envelope `source` field as the sender identifier.
 */
export const eventbridgeIngressIdentity = defineStableChannelIngressIdentity({
  key: "eventbridge-source",
  normalizeEntry: (entry) => entry.trim().toLowerCase() || null,
  normalizeSubject: (subject) => subject.trim().toLowerCase(),
  sensitivity: "normal",
  isWildcardEntry: (entry) => entry.trim() === "*",
});

/**
 * Extracts the `detail` field from an SQS message body that originated
 * from an EventBridge rule. Returns the detail object or null if the body
 * structure is not a valid EventBridge-to-SQS envelope.
 */
function extractDetail(body: unknown): unknown | null {
  if (body == null || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (!("detail" in record) || record.detail == null || typeof record.detail !== "object") {
    return null;
  }
  return record.detail;
}

/**
 * Processes a batch of inbound SQS messages:
 * 1. Parse each body as EventBridge event -> extract `detail` field
 * 2. Validate detail as Signal Envelope via zod
 * 3. Resolve ingress (access check via dmPolicy/allowFrom)
 * 4. If authorized -> deliver to agent
 * 5. Delete processed message from SQS (success or invalid/unauthorized)
 * 6. If invalid/unauthorized -> log, delete (do not requeue)
 */
export async function handleInboundBatch(params: {
  messages: PollResult[];
  config: ResolvedEventBridgeConfig;
  runtime: RuntimeEnv;
  sqsClient: SQSClient;
  deliverToAgent: (ctx: InboundEventContext) => Promise<void>;
  statusSink?: (patch: { lastInboundAt?: number }) => void;
}): Promise<void> {
  const { messages, config, runtime, sqsClient, deliverToAgent, statusSink } = params;

  for (const message of messages) {
    await processMessage({ message, config, runtime, sqsClient, deliverToAgent, statusSink });
  }
}

async function processMessage(params: {
  message: PollResult;
  config: ResolvedEventBridgeConfig;
  runtime: RuntimeEnv;
  sqsClient: SQSClient;
  deliverToAgent: (ctx: InboundEventContext) => Promise<void>;
  statusSink?: (patch: { lastInboundAt?: number }) => void;
}): Promise<void> {
  const { message, config, runtime, sqsClient, deliverToAgent, statusSink } = params;

  // Step 1: Extract detail from EventBridge-to-SQS body
  const detail = extractDetail(message.body);
  if (detail == null) {
    runtime.log?.(
      `eventbridge: drop message ${message.messageId} (invalid body or missing detail)`,
    );
    await safeDelete({
      sqsClient,
      queueUrl: config.queueUrl,
      receiptHandle: message.receiptHandle,
      runtime,
    });
    return;
  }

  // Step 2: Validate detail as Signal Envelope
  const parsed = parseInboundEnvelope(detail);
  if (!parsed.ok) {
    runtime.log?.(
      `eventbridge: drop message ${message.messageId} (envelope validation failed: ${parsed.error})`,
    );
    await safeDelete({
      sqsClient,
      queueUrl: config.queueUrl,
      receiptHandle: message.receiptHandle,
      runtime,
    });
    return;
  }

  const { envelope } = parsed;

  // Step 3: Resolve ingress access control
  const resolver = createChannelIngressResolver({
    channelId: CHANNEL_ID,
    accountId: "default",
    identity: eventbridgeIngressIdentity,
  });

  const access = await resolver.message({
    subject: { stableId: envelope.source },
    conversation: {
      kind: "direct",
      id: envelope.source,
    },
    dmPolicy: config.dmPolicy,
    allowFrom: config.allowFrom,
    event: { mayPair: false },
  });

  // Step 4: Check sender access decision
  if (access.senderAccess.decision !== "allow") {
    runtime.log?.(
      `eventbridge: drop message ${message.messageId} (unauthorized source: ${envelope.source})`,
    );
    await safeDelete({
      sqsClient,
      queueUrl: config.queueUrl,
      receiptHandle: message.receiptHandle,
      runtime,
    });
    return;
  }

  // Step 5: Deliver to agent
  const ctx: InboundEventContext = {
    envelope,
    sqsMessageId: message.messageId,
    receiptHandle: message.receiptHandle,
  };

  await deliverToAgent(ctx);
  statusSink?.({ lastInboundAt: Date.now() });

  // Step 6: Delete successfully processed message
  await safeDelete({
    sqsClient,
    queueUrl: config.queueUrl,
    receiptHandle: message.receiptHandle,
    runtime,
  });
}

/** Deletes a message from SQS, logging but not throwing on failure. */
async function safeDelete(params: {
  sqsClient: SQSClient;
  queueUrl: string;
  receiptHandle: string;
  runtime: RuntimeEnv;
}): Promise<void> {
  try {
    await deleteMessage({
      client: params.sqsClient,
      queueUrl: params.queueUrl,
      receiptHandle: params.receiptHandle,
    });
  } catch (error: unknown) {
    params.runtime.error?.(
      `eventbridge: failed to delete message (receiptHandle=${params.receiptHandle}): ${String(error)}`,
    );
  }
}
