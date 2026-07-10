import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk/status-helpers";
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockRunStoppablePassiveMonitor = vi.fn();
vi.mock("openclaw/plugin-sdk/extension-shared", () => ({
  runStoppablePassiveMonitor: (...args: unknown[]) => mockRunStoppablePassiveMonitor(...args),
}));

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: class {
    destroy = vi.fn();
  },
}));

vi.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: class {
    destroy = vi.fn();
  },
}));

vi.mock("./credentials.js", () => ({
  buildAwsCredentials: vi.fn(() => ({
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    region: "us-east-1",
  })),
}));

vi.mock("./poller.js", () => ({
  runSqsPoller: vi.fn(() => Promise.resolve()),
}));

vi.mock("./inbound.js", () => ({
  handleInboundBatch: vi.fn(() => Promise.resolve()),
}));

import { startEventBridgeGatewayAccount } from "./gateway.js";

function makeValidConfig(): Record<string, unknown> {
  return {
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789/test-queue",
    sourceNamespace: "test.ns",
    maxMessages: 10,
    waitTimeSeconds: 20,
    dmPolicy: "open",
    allowFrom: ["*"],
  };
}

describe("startEventBridgeGatewayAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("abort signal triggers clean shutdown", () => {
    it("resolves cleanly when abortSignal is aborted", async () => {
      const controller = new AbortController();
      const setStatus = vi.fn();

      // Mock runStoppablePassiveMonitor: call start(), get the monitor,
      // then call stop() when abort fires (simulating the real lifecycle).
      mockRunStoppablePassiveMonitor.mockImplementation(
        async (params: {
          abortSignal: AbortSignal;
          start: () => Promise<{ stop: () => void }>;
        }) => {
          const monitor = await params.start();
          // Simulate abort triggering stop
          if (params.abortSignal.aborted) {
            monitor.stop();
          } else {
            params.abortSignal.addEventListener("abort", () => monitor.stop(), { once: true });
            controller.abort();
          }
        },
      );

      // Should resolve without hanging
      await startEventBridgeGatewayAccount({
        cfg: makeValidConfig(),
        accountId: "test-account",
        abortSignal: controller.signal,
        setStatus,
      });

      // If we get here, the gateway resolved cleanly
      expect(mockRunStoppablePassiveMonitor).toHaveBeenCalledTimes(1);
    });

    it("passes abortSignal to runStoppablePassiveMonitor", async () => {
      const controller = new AbortController();
      controller.abort(); // Pre-abort

      mockRunStoppablePassiveMonitor.mockImplementation(
        async (params: {
          abortSignal: AbortSignal;
          start: () => Promise<{ stop: () => void }>;
        }) => {
          expect(params.abortSignal.aborted).toBe(true);
        },
      );

      await startEventBridgeGatewayAccount({
        cfg: makeValidConfig(),
        accountId: "test-account",
        abortSignal: controller.signal,
        setStatus: vi.fn(),
      });

      expect(mockRunStoppablePassiveMonitor).toHaveBeenCalledTimes(1);
    });
  });

  describe("status snapshot reports configured/running state", () => {
    it("sets initial status to configured=true, running=false", async () => {
      const setStatus = vi.fn();
      const controller = new AbortController();

      mockRunStoppablePassiveMonitor.mockImplementation(async () => {
        // Do not call start — just verify initial status was set before we get here
      });

      await startEventBridgeGatewayAccount({
        cfg: makeValidConfig(),
        accountId: "test-account",
        abortSignal: controller.signal,
        setStatus,
      });

      // The first setStatus call should be configured=true, running=false
      expect(setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "test-account",
          configured: true,
          running: false,
        }),
      );
    });

    it("sets running=true after start() is called", async () => {
      const setStatus = vi.fn();
      const controller = new AbortController();

      mockRunStoppablePassiveMonitor.mockImplementation(
        async (params: {
          abortSignal: AbortSignal;
          start: () => Promise<{ stop: () => void }>;
        }) => {
          const monitor = await params.start();
          monitor.stop();
        },
      );

      await startEventBridgeGatewayAccount({
        cfg: makeValidConfig(),
        accountId: "test-account",
        abortSignal: controller.signal,
        setStatus,
      });

      // After start() is called, status should transition to running=true
      const statusCalls = setStatus.mock.calls.map((call) => call[0] as ChannelAccountSnapshot);

      // Initial: configured=true, running=false
      expect(statusCalls[0]).toMatchObject({ configured: true, running: false });
      // After start: configured=true, running=true
      expect(statusCalls[1]).toMatchObject({ configured: true, running: true });
    });

    it("reports lastInboundAt/lastOutboundAt/lastError as null initially", async () => {
      const setStatus = vi.fn();
      const controller = new AbortController();

      mockRunStoppablePassiveMonitor.mockImplementation(async () => {});

      await startEventBridgeGatewayAccount({
        cfg: makeValidConfig(),
        accountId: "test-account",
        abortSignal: controller.signal,
        setStatus,
      });

      expect(setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          lastInboundAt: null,
          lastOutboundAt: null,
          lastError: null,
        }),
      );
    });
  });

  describe("invalid config surfaces status issues (not silent failure)", () => {
    it("throws an Error when queueUrl is missing", async () => {
      const controller = new AbortController();

      await expect(
        startEventBridgeGatewayAccount({
          cfg: { sourceNamespace: "test.ns" }, // missing queueUrl
          accountId: "bad-account",
          abortSignal: controller.signal,
          setStatus: vi.fn(),
        }),
      ).rejects.toThrow(/EventBridge config invalid/);
    });

    it("throws an Error when queueUrl is not a valid URL", async () => {
      const controller = new AbortController();

      await expect(
        startEventBridgeGatewayAccount({
          cfg: { queueUrl: "not-a-url" },
          accountId: "bad-account",
          abortSignal: controller.signal,
          setStatus: vi.fn(),
        }),
      ).rejects.toThrow(/EventBridge config invalid/);
    });

    it("includes accountId in the error message", async () => {
      const controller = new AbortController();

      await expect(
        startEventBridgeGatewayAccount({
          cfg: {},
          accountId: "my-acct-123",
          abortSignal: controller.signal,
          setStatus: vi.fn(),
        }),
      ).rejects.toThrow(/my-acct-123/);
    });

    it("does not call setStatus when config is invalid", async () => {
      const controller = new AbortController();
      const setStatus = vi.fn();

      await expect(
        startEventBridgeGatewayAccount({
          cfg: {},
          accountId: "bad-account",
          abortSignal: controller.signal,
          setStatus,
        }),
      ).rejects.toThrow();

      expect(setStatus).not.toHaveBeenCalled();
    });
  });
});
