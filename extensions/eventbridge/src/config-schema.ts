import {
  DmPolicySchema,
  buildChannelConfigSchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
// EventBridge channel config schema with cross-field validation.
import { z } from "zod";

export const EventBridgeConfigSchema = z
  .object({
    queueUrl: z.string().url(),
    busName: z.string().optional(),
    busArn: z.string().optional(),
    sourceNamespace: z.string().default("openclaw.agent"),
    region: z.string().optional(),
    pollIntervalMs: z.number().int().min(0).max(60_000).optional(),
    maxMessages: z.number().int().min(1).max(10).default(10),
    waitTimeSeconds: z.number().int().min(0).max(20).default(20),
    dmPolicy: DmPolicySchema.optional().default("allowlist"),
    allowFrom: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message:
        'channels.eventbridge.dmPolicy="open" requires channels.eventbridge.allowFrom to include "*"',
    });
  });

export const EventBridgeChannelConfigSchema = buildChannelConfigSchema(EventBridgeConfigSchema);
