// EventBridge config schema unit tests.
import { describe, expect, it } from "vitest";
import { EventBridgeConfigSchema } from "./config-schema.js";

const VALID_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue";

function expectValidConfig(result: ReturnType<typeof EventBridgeConfigSchema.safeParse>) {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("expected config to be valid");
  }
  return result.data;
}

function expectInvalidConfig(result: ReturnType<typeof EventBridgeConfigSchema.safeParse>) {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("expected config to be invalid");
  }
  return result.error.issues;
}

describe("eventbridge config schema", () => {
  it("accepts valid minimal config", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL }),
    );
    expect(config.queueUrl).toBe(VALID_QUEUE_URL);
  });

  it("rejects missing queueUrl", () => {
    const issues = expectInvalidConfig(EventBridgeConfigSchema.safeParse({}));
    expect(issues.some((i) => i.path.includes("queueUrl"))).toBe(true);
  });

  it("rejects invalid queueUrl", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: "not-a-url" }),
    );
    expect(issues.some((i) => i.path.includes("queueUrl"))).toBe(true);
  });

  it("rejects unknown fields (strict mode)", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, unknownField: true }),
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it('rejects dmPolicy="open" without allowFrom "*"', () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({
        queueUrl: VALID_QUEUE_URL,
        dmPolicy: "open",
        allowFrom: ["alice"],
      }),
    );
    expect(issues[0]?.path.join(".")).toBe("allowFrom");
  });

  it('accepts dmPolicy="open" with allowFrom ["*"]', () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({
        queueUrl: VALID_QUEUE_URL,
        dmPolicy: "open",
        allowFrom: ["*"],
      }),
    );
    expect(config.dmPolicy).toBe("open");
  });

  it('accepts dmPolicy="allowlist" without allowFrom', () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({
        queueUrl: VALID_QUEUE_URL,
        dmPolicy: "allowlist",
      }),
    );
    expect(config.dmPolicy).toBe("allowlist");
  });

  it("rejects maxMessages below minimum (0)", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, maxMessages: 0 }),
    );
    expect(issues.some((i) => i.path.includes("maxMessages"))).toBe(true);
  });

  it("accepts maxMessages at minimum (1)", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, maxMessages: 1 }),
    );
    expect(config.maxMessages).toBe(1);
  });

  it("accepts maxMessages at maximum (10)", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, maxMessages: 10 }),
    );
    expect(config.maxMessages).toBe(10);
  });

  it("rejects maxMessages above maximum (11)", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, maxMessages: 11 }),
    );
    expect(issues.some((i) => i.path.includes("maxMessages"))).toBe(true);
  });

  it("rejects waitTimeSeconds below minimum (-1)", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, waitTimeSeconds: -1 }),
    );
    expect(issues.some((i) => i.path.includes("waitTimeSeconds"))).toBe(true);
  });

  it("accepts waitTimeSeconds at minimum (0)", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, waitTimeSeconds: 0 }),
    );
    expect(config.waitTimeSeconds).toBe(0);
  });

  it("accepts waitTimeSeconds at maximum (20)", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, waitTimeSeconds: 20 }),
    );
    expect(config.waitTimeSeconds).toBe(20);
  });

  it("rejects waitTimeSeconds above maximum (21)", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, waitTimeSeconds: 21 }),
    );
    expect(issues.some((i) => i.path.includes("waitTimeSeconds"))).toBe(true);
  });

  it("rejects pollIntervalMs below minimum (-1)", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, pollIntervalMs: -1 }),
    );
    expect(issues.some((i) => i.path.includes("pollIntervalMs"))).toBe(true);
  });

  it("accepts pollIntervalMs at minimum (0)", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, pollIntervalMs: 0 }),
    );
    expect(config.pollIntervalMs).toBe(0);
  });

  it("accepts pollIntervalMs at maximum (60000)", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, pollIntervalMs: 60000 }),
    );
    expect(config.pollIntervalMs).toBe(60000);
  });

  it("rejects pollIntervalMs above maximum (60001)", () => {
    const issues = expectInvalidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL, pollIntervalMs: 60001 }),
    );
    expect(issues.some((i) => i.path.includes("pollIntervalMs"))).toBe(true);
  });

  it("applies correct defaults", () => {
    const config = expectValidConfig(
      EventBridgeConfigSchema.safeParse({ queueUrl: VALID_QUEUE_URL }),
    );
    expect(config.sourceNamespace).toBe("openclaw.agent");
    expect(config.maxMessages).toBe(10);
    expect(config.waitTimeSeconds).toBe(20);
    expect(config.dmPolicy).toBe("allowlist");
  });
});
