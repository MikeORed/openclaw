import { describe, it, expect, vi, beforeEach } from "vitest";

const destroyMock = vi.fn();
const sendMock = vi.fn();

vi.mock("@aws-sdk/client-sqs", () => {
  return {
    SQSClient: class {
      send = sendMock;
      destroy = destroyMock;
    },
    ReceiveMessageCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
  };
});

vi.mock("./credentials.js", () => ({
  buildAwsCredentials: vi.fn(() => ({
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    region: "us-east-1",
  })),
}));

import { probeEventBridge } from "./probe.js";
import type { ResolvedEventBridgeConfig } from "./types.js";

function makeConfig(overrides?: Partial<ResolvedEventBridgeConfig>): ResolvedEventBridgeConfig {
  return {
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789/test-queue",
    sourceNamespace: "test.ns",
    pollIntervalMs: 5000,
    maxMessages: 10,
    waitTimeSeconds: 20,
    dmPolicy: "open",
    ...overrides,
  };
}

describe("probeEventBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok: true with latencyMs on successful probe", async () => {
    sendMock.mockResolvedValueOnce({ Messages: [] });

    const config = makeConfig();
    const result = await probeEventBridge(config);

    expect(result.ok).toBe(true);
    expect(result.queueUrl).toBe(config.queueUrl);
    expect(result.latencyMs).toBeTypeOf("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns ok: false with error message on failed probe", async () => {
    sendMock.mockRejectedValueOnce(new Error("Access denied"));

    const config = makeConfig();
    const result = await probeEventBridge(config);

    expect(result.ok).toBe(false);
    expect(result.queueUrl).toBe(config.queueUrl);
    expect(result.error).toBe("Access denied");
    expect(result.latencyMs).toBeUndefined();
  });

  it("formats string errors correctly", async () => {
    sendMock.mockRejectedValueOnce("connection timeout");

    const result = await probeEventBridge(makeConfig());

    expect(result.ok).toBe(false);
    expect(result.error).toBe("connection timeout");
  });

  it("formats non-Error non-string errors as JSON", async () => {
    sendMock.mockRejectedValueOnce({ code: "UNKNOWN", retryable: false });

    const result = await probeEventBridge(makeConfig());

    expect(result.ok).toBe(false);
    expect(result.error).toBe(JSON.stringify({ code: "UNKNOWN", retryable: false }));
  });

  it("always destroys the client after probe", async () => {
    sendMock.mockResolvedValueOnce({ Messages: [] });
    await probeEventBridge(makeConfig());
    expect(destroyMock).toHaveBeenCalledTimes(1);

    destroyMock.mockClear();
    sendMock.mockRejectedValueOnce(new Error("fail"));
    await probeEventBridge(makeConfig());
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});
