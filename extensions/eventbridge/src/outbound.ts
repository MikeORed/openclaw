// EventBridge channel plugin outbound adapter.
// Wraps agent messages in Signal Envelopes and emits them onto an EventBridge bus via PutEvents.

import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { wrapOutboundEnvelope } from "./envelope.js";

export type OutboundSendResult = {
  messageId: string;
  eventId?: string;
};

export type OutboundParams = {
  client: EventBridgeClient;
  busName?: string;
  source: string;
  detailType: string;
  correlationId: string;
  causationId?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
};

/**
 * Core outbound send: wraps payload in Signal Envelope, calls PutEvents.
 * On partial failure (FailedEntryCount > 0), re-sends entire batch once.
 * On full failure (throw from PutEvents), propagates the error — no retry.
 * If envelope wrapping fails, rejects without calling PutEvents.
 */
export async function sendEventBridgeOutbound(params: OutboundParams): Promise<OutboundSendResult> {
  const {
    client,
    busName,
    source,
    detailType,
    correlationId,
    causationId,
    payload,
    metadata,
    statusSink,
  } = params;

  // Wrap in Signal Envelope; reject if wrapping fails
  const envelope = wrapOutboundEnvelope({
    source,
    detailType,
    correlationId,
    causationId,
    payload,
    metadata,
  });

  if (envelope == null) {
    throw new Error(
      `eventbridge outbound: envelope wrapping failed (source=${source}, detailType=${detailType})`,
    );
  }

  const entry = {
    Source: source,
    DetailType: detailType,
    Detail: JSON.stringify(envelope),
    ...(busName ? { EventBusName: busName } : {}),
  };

  const command = new PutEventsCommand({ Entries: [entry] });

  // First attempt
  const response = await client.send(command);

  // On partial failure, re-send entire batch once
  if (response.FailedEntryCount && response.FailedEntryCount > 0) {
    const retryResponse = await client.send(command);
    statusSink?.({ lastOutboundAt: Date.now() });
    return {
      messageId: correlationId,
      eventId: retryResponse.Entries?.[0]?.EventId,
    };
  }

  statusSink?.({ lastOutboundAt: Date.now() });
  return {
    messageId: correlationId,
    eventId: response.Entries?.[0]?.EventId,
  };
}

/**
 * Sends a text message as an outbound EventBridge event.
 * Wraps text in Signal Envelope payload → PutEvents.
 */
export async function sendText(params: {
  client: EventBridgeClient;
  busName?: string;
  sourceNamespace: string;
  text: string;
  correlationId: string;
  causationId?: string;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<OutboundSendResult> {
  return sendEventBridgeOutbound({
    client: params.client,
    busName: params.busName,
    source: params.sourceNamespace,
    detailType: "AgentMessage",
    correlationId: params.correlationId,
    causationId: params.causationId,
    payload: { text: params.text },
    statusSink: params.statusSink,
  });
}

/**
 * Sends a media message as an outbound EventBridge event.
 * Includes mediaUrl as a URL reference in the payload (not inline binary).
 */
export async function sendMedia(params: {
  client: EventBridgeClient;
  busName?: string;
  sourceNamespace: string;
  text: string;
  mediaUrl: string;
  correlationId: string;
  causationId?: string;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<OutboundSendResult> {
  return sendEventBridgeOutbound({
    client: params.client,
    busName: params.busName,
    source: params.sourceNamespace,
    detailType: "AgentMedia",
    correlationId: params.correlationId,
    causationId: params.causationId,
    payload: { text: params.text, mediaUrl: params.mediaUrl },
    statusSink: params.statusSink,
  });
}
