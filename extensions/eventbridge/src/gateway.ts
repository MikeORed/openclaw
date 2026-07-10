// EventBridge channel plugin gateway lifecycle module.
// Orchestrates config validation, AWS client construction, and the SQS poll loop.

import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { SQSClient } from "@aws-sdk/client-sqs";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk/status-helpers";
import { EventBridgeConfigSchema } from "./config-schema.js";
import { buildAwsCredentials } from "./credentials.js";
import { handleInboundBatch } from "./inbound.js";
import { runSqsPoller } from "./poller.js";
import type { InboundEventContext, ResolvedEventBridgeConfig } from "./types.js";

/**
 * Starts the EventBridge gateway account lifecycle.
 * Validates config, builds AWS clients, then runs the SQS poller
 * inside a stoppable passive monitor until the abort signal fires.
 */
export async function startEventBridgeGatewayAccount(ctx: {
  cfg: Record<string, unknown>;
  accountId: string;
  abortSignal: AbortSignal;
  setStatus: (next: ChannelAccountSnapshot) => void;
  deliverToAgent?: (eventCtx: InboundEventContext) => Promise<void>;
  log?: { info?: (msg: string) => void; error?: (msg: string) => void };
}): Promise<void> {
  // Validate config — surface errors rather than failing silently.
  const parsed = EventBridgeConfigSchema.safeParse(ctx.cfg);
  if (!parsed.success) {
    throw new Error(
      `EventBridge config invalid for account "${ctx.accountId}": ${parsed.error.message}`,
    );
  }

  const config: ResolvedEventBridgeConfig = {
    ...parsed.data,
    pollIntervalMs: parsed.data.pollIntervalMs ?? 0,
  };

  ctx.log?.info?.(`[${ctx.accountId}] starting EventBridge gateway (queue: ${config.queueUrl})`);

  // Build AWS clients using standard credential chain.
  const { credentials, region } = buildAwsCredentials({ region: config.region });
  const sqsClient = new SQSClient({ credentials, region });
  const _ebClient = new EventBridgeClient({ credentials, region });

  // Mutable snapshot — updated at lifecycle transitions and on activity.
  const snapshot: ChannelAccountSnapshot = {
    accountId: ctx.accountId,
    configured: true,
    running: false,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastError: null,
  };
  ctx.setStatus({ ...snapshot });

  await runStoppablePassiveMonitor({
    abortSignal: ctx.abortSignal,
    start: async () => {
      // Mark running before the poller begins.
      snapshot.running = true;
      ctx.setStatus({ ...snapshot });

      const pollerAbort = new AbortController();

      // Minimal runtime for inbound processing (log-backed).
      const runtime = {
        log: (...args: unknown[]) => ctx.log?.info?.(args.map(String).join(" ")),
        error: (...args: unknown[]) => ctx.log?.error?.(args.map(String).join(" ")),
        exit: () => {
          // Gateway monitor never exits the process.
        },
      };

      // Start the poller as a background promise (do not await in start).
      const pollerPromise = runSqsPoller({
        client: sqsClient,
        config: {
          queueUrl: config.queueUrl,
          maxMessages: config.maxMessages,
          waitTimeSeconds: config.waitTimeSeconds,
          region,
        },
        callbacks: {
          onMessages: async (messages) => {
            await handleInboundBatch({
              messages,
              config,
              runtime,
              sqsClient,
              deliverToAgent: ctx.deliverToAgent ?? noopDeliverToAgent,
              statusSink: (patch) => {
                if (patch.lastInboundAt != null) {
                  snapshot.lastInboundAt = patch.lastInboundAt;
                  ctx.setStatus({ ...snapshot });
                }
              },
            });
          },
          onError: (error) => {
            const msg = error instanceof Error ? error.message : String(error);
            snapshot.lastError = msg;
            ctx.setStatus({ ...snapshot });
            ctx.log?.error?.(`[${ctx.accountId}] poller error: ${msg}`);
          },
          statusSink: (patch) => {
            if (patch.lastInboundAt != null) {
              snapshot.lastInboundAt = patch.lastInboundAt;
              ctx.setStatus({ ...snapshot });
            }
          },
        },
        abortSignal: pollerAbort.signal,
      });

      // When the poller finishes (due to abort), mark stopped.
      pollerPromise.then(() => {
        snapshot.running = false;
        ctx.setStatus({ ...snapshot });
      });

      return {
        stop: () => {
          pollerAbort.abort();
        },
      };
    },
  });
}

/** No-op placeholder for deliverToAgent when not yet wired. */
async function noopDeliverToAgent(_ctx: InboundEventContext): Promise<void> {
  // Placeholder — the real callback is provided by channel.ts wiring.
}
