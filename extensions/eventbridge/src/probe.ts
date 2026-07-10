import { SQSClient, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { buildAwsCredentials } from "./credentials.js";
import type { ResolvedEventBridgeConfig } from "./types.js";

export type EventBridgeProbe = {
  ok: boolean;
  queueUrl: string;
  error?: string;
  latencyMs?: number;
};

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return typeof err === "string" ? err : JSON.stringify(err);
}

/**
 * Sends a lightweight ReceiveMessage (WaitTimeSeconds=0, MaxNumberOfMessages=1)
 * to verify SQS queue accessibility. Returns probe result with latency on success
 * or error message on failure.
 */
export async function probeEventBridge(
  config: ResolvedEventBridgeConfig,
): Promise<EventBridgeProbe> {
  const { queueUrl } = config;
  const base: EventBridgeProbe = { ok: false, queueUrl };

  const { credentials, region } = buildAwsCredentials({ region: config.region });
  const client = new SQSClient({ credentials, region });

  const started = Date.now();
  try {
    await client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        WaitTimeSeconds: 0,
        MaxNumberOfMessages: 1,
      }),
    );
    const latencyMs = Date.now() - started;
    return { ...base, ok: true, latencyMs };
  } catch (err) {
    return { ...base, error: formatError(err) };
  } finally {
    client.destroy();
  }
}
