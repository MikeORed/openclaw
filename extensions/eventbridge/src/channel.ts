// EventBridge channel plugin definition: config, status, gateway startup, and outbound.
// Strictly transport-only: no payload interpretation, no commands, no interactive surfaces.
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { EventBridgeChannelConfigSchema } from "./config-schema.js";
import { buildAwsCredentials } from "./credentials.js";
import { startEventBridgeGatewayAccount } from "./gateway.js";
import { getOutboundStatusSink } from "./outbound-status.js";
import { sendMedia as sendMediaOutbound, sendText as sendTextOutbound } from "./outbound.js";
import { probeEventBridge, type EventBridgeProbe } from "./probe.js";
import type { ResolvedEventBridgeConfig } from "./types.js";

const CHANNEL_ID = "eventbridge" as const;
const DEFAULT_ACCOUNT_ID = "default";

type EventBridgeAccount = {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: ResolvedEventBridgeConfig;
};

/**
 * Channel plugin instance registered by the bundled EventBridge entry.
 * Transport-only: no payload interpretation, no slash commands, no interactive surfaces.
 */
export const eventbridgePlugin: ChannelPlugin<EventBridgeAccount, EventBridgeProbe> =
  createChatChannelPlugin({
    base: {
      id: CHANNEL_ID,
      meta: {
        id: CHANNEL_ID,
        label: "EventBridge",
        selectionLabel: "AWS EventBridge (SQS \u2192 Bus)",
        docsPath: "/channels/eventbridge",
        docsLabel: "eventbridge",
        blurb: "AWS EventBridge events via SQS inbound and PutEvents outbound.",
        order: 90,
        detailLabel: "EventBridge",
        systemImage: "bolt",
        markdownCapable: false,
      },
      capabilities: {
        chatTypes: ["direct"],
        media: true,
      },
      reload: { configPrefixes: ["channels.eventbridge"] },
      configSchema: EventBridgeChannelConfigSchema,
      config: {
        hasConfiguredState: ({ env }) =>
          typeof env?.EVENTBRIDGE_QUEUE_URL === "string" &&
          env.EVENTBRIDGE_QUEUE_URL.trim().length > 0,
        listAccountIds: () => [DEFAULT_ACCOUNT_ID],
        resolveAccount: (cfg) => resolveEventBridgeAccount(cfg),
        defaultAccountId: () => DEFAULT_ACCOUNT_ID,
        isConfigured: (account) => account.configured,
        resolveAllowFrom: ({ cfg }) => resolveEventBridgeAccount(cfg).config.allowFrom,
      },
      status: createComputedAccountStatusAdapter<EventBridgeAccount, EventBridgeProbe>({
        defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
        buildChannelSummary: ({ account, snapshot }) => ({
          ok: account.configured,
          label: account.configured ? "configured" : "not configured",
          queueUrl: account.config.queueUrl,
          probe: snapshot.probe ?? null,
          lastProbeAt: snapshot.lastProbeAt ?? null,
        }),
        probeAccount: async ({ cfg }) => {
          const account = resolveEventBridgeAccount(cfg);
          if (!account.configured) {
            return { ok: false, queueUrl: "", error: "not configured" };
          }
          return probeEventBridge(account.config);
        },
        resolveAccountSnapshot: ({ account }) => ({
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled,
          configured: account.configured,
        }),
      }),
      gateway: {
        startAccount: async (ctx) =>
          await startEventBridgeGatewayAccount({
            ...ctx,
            cfg: ctx.cfg as Record<string, unknown>,
          }),
      },
    },
    outbound: {
      base: {
        deliveryMode: "direct",
      },
      attachedResults: {
        channel: CHANNEL_ID,
        sendText: async ({ cfg, to, text }) => {
          const account = resolveEventBridgeAccount(cfg);
          const { credentials, region } = buildAwsCredentials({ region: account.config.region });
          const client = new EventBridgeClient({ credentials, region });
          const correlationId = crypto.randomUUID();
          const result = await sendTextOutbound({
            client,
            busName: account.config.busName,
            sourceNamespace: account.config.sourceNamespace,
            text,
            correlationId,
            causationId: to || undefined,
            statusSink: getOutboundStatusSink(),
          });
          return { messageId: result.messageId };
        },
        sendMedia: async ({ cfg, to, text, mediaUrl }) => {
          const account = resolveEventBridgeAccount(cfg);
          const { credentials, region } = buildAwsCredentials({ region: account.config.region });
          const client = new EventBridgeClient({ credentials, region });
          const correlationId = crypto.randomUUID();
          const result = await sendMediaOutbound({
            client,
            busName: account.config.busName,
            sourceNamespace: account.config.sourceNamespace,
            text,
            mediaUrl: mediaUrl ?? "",
            correlationId,
            causationId: to || undefined,
            statusSink: getOutboundStatusSink(),
          });
          return { messageId: result.messageId };
        },
      },
    },
  });

/**
 * Resolves the EventBridge account from the full OpenClaw config.
 * Single-account plugin — always returns the default account.
 * Synchronous: extracts raw config values with manual defaults.
 */
function resolveEventBridgeAccount(cfg: unknown): EventBridgeAccount {
  const root = cfg as Record<string, unknown> | undefined;
  const channels = root?.channels as Record<string, unknown> | undefined;
  const raw = channels?.eventbridge;

  if (raw == null || typeof raw !== "object") {
    return {
      accountId: DEFAULT_ACCOUNT_ID,
      name: "EventBridge",
      enabled: false,
      configured: false,
      config: {
        queueUrl: "",
        sourceNamespace: "openclaw.agent",
        pollIntervalMs: 0,
        maxMessages: 10,
        waitTimeSeconds: 20,
        dmPolicy: "allowlist",
      },
    };
  }

  const rawObj = raw as Record<string, unknown>;
  const queueUrl = typeof rawObj.queueUrl === "string" ? rawObj.queueUrl : "";

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    name: "EventBridge",
    enabled: true,
    configured: queueUrl.length > 0,
    config: {
      queueUrl,
      busName: typeof rawObj.busName === "string" ? rawObj.busName : undefined,
      busArn: typeof rawObj.busArn === "string" ? rawObj.busArn : undefined,
      sourceNamespace:
        typeof rawObj.sourceNamespace === "string" ? rawObj.sourceNamespace : "openclaw.agent",
      region: typeof rawObj.region === "string" ? rawObj.region : undefined,
      pollIntervalMs: typeof rawObj.pollIntervalMs === "number" ? rawObj.pollIntervalMs : 0,
      maxMessages: typeof rawObj.maxMessages === "number" ? rawObj.maxMessages : 10,
      waitTimeSeconds: typeof rawObj.waitTimeSeconds === "number" ? rawObj.waitTimeSeconds : 20,
      dmPolicy: isValidDmPolicy(rawObj.dmPolicy) ? rawObj.dmPolicy : "allowlist",
      allowFrom: Array.isArray(rawObj.allowFrom) ? (rawObj.allowFrom as string[]) : undefined,
    },
  };
}

function isValidDmPolicy(value: unknown): value is "open" | "pairing" | "allowlist" {
  return value === "open" || value === "pairing" || value === "allowlist";
}
