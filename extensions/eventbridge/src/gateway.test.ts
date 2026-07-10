import { describe, it, expect, vi, beforeEach } from "vitest";
import { startEventBridgeGatewayAccount } from "./gateway.js";

// Hoist mocks so vi.mock factories can reference them.
const runStoppablePassiveMonitorMock = vi.hoisted(() => vi.fn());
const runSqsPollerMock = vi.hoisted(() => vi.fn());
const handleInboundBatchMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/extension-shared", () => ({
  runStoppablePassiveMonitor: runStoppablePassiveMonitorMock,
}));

vi.mock("./poller.js", () => ({
  runSqsPoller: runSqsPollerMock,
}));

vi.mock("./inbound.js", () => ({
  handleInboundBatch: handleInboundBatchMock,
}));

vi.mock("./credentials.js", () => ({
  buildAwsCredentials: vi.fn(() => ({
    credentials: {},
    region: "us-east-1",
  })),
}));

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: vi.fn(() => ({})),
}));

const validConfig = {
  queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789/test-queue",
  sourceNamespace: "openclaw.test",
  maxMessages: 10,
  waitTimeSeconds: 20,
  dmPolicy: "allowlist",
};

describe("startEventBridgeGatewayAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: runStoppablePassiveMonitor resolves immediately without calling start.
    runStoppablePassiveMonitorMock.mockResolvedValue(undefined);
    runSqsPollerMock.mockResolvedValue(undefined);
  });

  describe("invalid config", () => {
    it("throws when config is invalid (missing queueUrl)", async () => {
      const setStatus = vi.fn();
      await expect(
        startEventBridgeGatewayAccount({
          cfg: {},
          accountId: "test-account",
          abortSignal: new AbortController().signal,
          setStatus,
        }),
      ).rejects.toThrow(/invalid/i);
    });

    it("throws when queueUrl is not a valid URL", async () => {
      const setStatus = vi.fn();
      await expect(
        startEventBridgeGatewayAccount({
          cfg: { queueUrl: "not-a-url" },
          accountId: "test-account",
          abortSignal: new AbortController().signal,
          setStatus,
        }),
      ).rejects.toThrow(/invalid/i);
    });

    it("includes account ID in the error message", async () => {
      const setStatus = vi.fn();
      await expect(
        startEventBridgeGatewayAccount({
          cfg: {},
          accountId: "my-eb-account",
          abortSignal: new AbortController().signal,
          setStatus,
        }),
      ).rejects.toThrow("my-eb-account");
    });
  });

  describe("status snapshots", () => {
    it("reports configured=true before starting the monitor", async () => {
      const setStatus = vi.fn();

      await startEventBridgeGatewayAccount({
        cfg: validConfig,
        accountId: "test-account",
        abortSignal: new AbortController().signal,
        setStatus,
      });

      // First setStatus call should have configured: true, running: false.
      expect(setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "test-account",
          configured: true,
          running: false,
        }),
      );
    });

    it("reports running=true when start callback is invoked", async () => {
      const setStatus = vi.fn();

      // Simulate the monitor calling start() to exercise the running transition.
      runStoppablePassiveMonitorMock.mockImplementation(async ({ start }) => {
        const monitor = await start();
        monitor.stop();
      });
      runSqsPollerMock.mockResolvedValue(undefined);

      await startEventBridgeGatewayAccount({
        cfg: validConfig,
        accountId: "test-account",
        abortSignal: new AbortController().signal,
        setStatus,
      });

      // After start is called, setStatus should have been called with running: true.
      const runningCall = setStatus.mock.calls.find((call) => call[0].running === true);
      expect(runningCall).toBeDefined();
      expect(runningCall![0]).toMatchObject({
        configured: true,
        running: true,
      });
    });
  });

  describe("abort / clean shutdown", () => {
    it("passes the lifecycle to runStoppablePassiveMonitor with the abortSignal", async () => {
      const setStatus = vi.fn();
      const controller = new AbortController();

      await startEventBridgeGatewayAccount({
        cfg: validConfig,
        accountId: "test-account",
        abortSignal: controller.signal,
        setStatus,
      });

      expect(runStoppablePassiveMonitorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: controller.signal,
        }),
      );
    });

    it("stop() from the monitor aborts the poller", async () => {
      const setStatus = vi.fn();
      let pollerAbortSignal: AbortSignal | undefined;

      runSqsPollerMock.mockImplementation(async (opts: any) => {
        pollerAbortSignal = opts.abortSignal;
      });

      runStoppablePassiveMonitorMock.mockImplementation(async ({ start }) => {
        const monitor = await start();
        // At this point the poller was called — verify its abort signal is not yet aborted.
        expect(pollerAbortSignal?.aborted).toBe(false);
        // Now simulate shutdown.
        monitor.stop();
        expect(pollerAbortSignal?.aborted).toBe(true);
      });

      await startEventBridgeGatewayAccount({
        cfg: validConfig,
        accountId: "test-account",
        abortSignal: new AbortController().signal,
        setStatus,
      });
    });
  });

  describe("poller integration", () => {
    it("starts the poller with correct config values", async () => {
      const setStatus = vi.fn();
      runSqsPollerMock.mockResolvedValue(undefined);

      runStoppablePassiveMonitorMock.mockImplementation(async ({ start }) => {
        const monitor = await start();
        monitor.stop();
      });

      await startEventBridgeGatewayAccount({
        cfg: validConfig,
        accountId: "test-account",
        abortSignal: new AbortController().signal,
        setStatus,
      });

      expect(runSqsPollerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            queueUrl: validConfig.queueUrl,
            maxMessages: validConfig.maxMessages,
            waitTimeSeconds: validConfig.waitTimeSeconds,
          }),
        }),
      );
    });

    it("updates lastError in status when poller reports an error", async () => {
      const setStatus = vi.fn();

      runSqsPollerMock.mockImplementation(async (opts: any) => {
        // Simulate a poller error callback.
        opts.callbacks.onError(new Error("SQS timeout"));
      });

      runStoppablePassiveMonitorMock.mockImplementation(async ({ start }) => {
        const monitor = await start();
        monitor.stop();
      });

      await startEventBridgeGatewayAccount({
        cfg: validConfig,
        accountId: "test-account",
        abortSignal: new AbortController().signal,
        setStatus,
      });

      const errorCall = setStatus.mock.calls.find((call) => call[0].lastError != null);
      expect(errorCall).toBeDefined();
      expect(errorCall![0].lastError).toBe("SQS timeout");
    });
  });
});
