// SQS long-poll loop for EventBridge channel plugin inbound messages.

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { createExponentialBackoff } from "./backoff.js";
import type { PollResult } from "./types.js";

export type PollerConfig = {
  queueUrl: string;
  maxMessages: number;
  waitTimeSeconds: number;
  region?: string;
};

export type PollerCallbacks = {
  onMessages: (messages: PollResult[]) => Promise<void>;
  onError: (error: unknown) => void;
  statusSink?: (patch: { lastInboundAt?: number }) => void;
};

/**
 * Sleeps for the given duration, resolving early if the abort signal fires.
 * Returns true if the signal was aborted during the sleep.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      resolve(true);
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs the SQS long-poll loop until abortSignal fires.
 * Retries with exponential backoff on transient errors.
 */
export async function runSqsPoller(params: {
  client: SQSClient;
  config: PollerConfig;
  callbacks: PollerCallbacks;
  abortSignal: AbortSignal;
}): Promise<void> {
  const { client, config, callbacks, abortSignal } = params;
  const backoff = createExponentialBackoff();

  while (!abortSignal.aborted) {
    try {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: config.queueUrl,
          MaxNumberOfMessages: config.maxMessages,
          WaitTimeSeconds: config.waitTimeSeconds,
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
        { abortSignal },
      );

      if (response.Messages && response.Messages.length > 0) {
        const parsed: PollResult[] = response.Messages.map((msg) => ({
          messageId: msg.MessageId ?? "",
          receiptHandle: msg.ReceiptHandle ?? "",
          body: parseBody(msg.Body),
          approximateReceiveCount: Number(msg.Attributes?.ApproximateReceiveCount ?? "1"),
        }));

        await callbacks.onMessages(parsed);
        callbacks.statusSink?.({ lastInboundAt: Date.now() });
      }

      backoff.reset();
    } catch (error: unknown) {
      // AbortError means graceful shutdown — do not treat as transient failure.
      if (abortSignal.aborted) break;

      callbacks.onError(error);
      const delay = backoff.next();
      const aborted = await abortableSleep(delay, abortSignal);
      if (aborted) break;
    }
  }
}

/** Deletes a successfully-processed message from SQS. */
export async function deleteMessage(params: {
  client: SQSClient;
  queueUrl: string;
  receiptHandle: string;
}): Promise<void> {
  await params.client.send(
    new DeleteMessageCommand({
      QueueUrl: params.queueUrl,
      ReceiptHandle: params.receiptHandle,
    }),
  );
}

/** Parses a message body as JSON; falls back to raw string if parsing fails. */
function parseBody(body: string | undefined): unknown {
  if (body == null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
