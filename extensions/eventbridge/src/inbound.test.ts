import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleInboundBatch } from "./inbound.js";
import type { ResolvedEventBridgeConfig, PollResult } from "./types.js";

vi.mock("openclaw/plugin-sdk/channel-ingress-runtime", () => ({
  createChannelIngressResolver: vi.fn(),
  defineStableChannelIngressIdentity: vi.fn((params) => params),
}));

vi.mock("./poller.js", () => ({
  deleteMessage: vi.fn().mockResolvedValue(undefined),
}));

import { createChannelIngressResolver } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { deleteMessage } from "./poller.js";

const baseConfig: ResolvedEventBridgeConfig = {
  queueUrl: "https://sqs.us-east-1.amazonaws.com/123/test-queue",
  sourceNamespace: "openclaw.agent",
  pollIntervalMs: 0,
  maxMessages: 10,
  waitTimeSeconds: 20,
  dmPolicy: "allowlist",
  allowFrom: ["myapp.orders"],
};

const validEnvelopeBody = {
  version: "0",
  id: "eb-event-id",
  "detail-type": "OrderCreated",
  source: "myapp.orders",
  account: "123456789",
  time: "2024-01-01T00:00:00Z",
  region: "us-east-1",
  resources: [],
  detail: {
    source: "myapp.orders",
    detailType: "OrderCreated",
    correlationId: "550e8400-e29b-41d4-a716-446655440000",
    payload: { orderId: "order-123" },
  },
};

function createMockRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

function createMockSqsClient() {
  return { send: vi.fn() } as any;
}

function createAllowResolver() {
  const resolver = {
    message: vi.fn().mockResolvedValue({
      senderAccess: { decision: "allow" },
      ingress: { admission: "dispatch" },
    }),
  };
  vi.mocked(createChannelIngressResolver).mockReturnValue(resolver as any);
  return resolver;
}

function createDenyResolver() {
  const resolver = {
    message: vi.fn().mockResolvedValue({
      senderAccess: { decision: "deny" },
      ingress: { admission: "reject" },
    }),
  };
  vi.mocked(createChannelIngressResolver).mockReturnValue(resolver as any);
  return resolver;
}

describe("inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleInboundBatch", () => {
    it("delivers valid envelope to agent after ingress approval", async () => {
      createAllowResolver();
      const deliverToAgent = vi.fn().mockResolvedValue(undefined);
      const statusSink = vi.fn();
      const runtime = createMockRuntime();
      const sqsClient = createMockSqsClient();

      const messages: PollResult[] = [
        {
          messageId: "msg-1",
          receiptHandle: "rh-1",
          body: validEnvelopeBody,
          approximateReceiveCount: 1,
        },
      ];

      await handleInboundBatch({
        messages,
        config: baseConfig,
        runtime,
        sqsClient,
        deliverToAgent,
        statusSink,
      });

      expect(deliverToAgent).toHaveBeenCalledTimes(1);
      expect(deliverToAgent).toHaveBeenCalledWith({
        envelope: validEnvelopeBody.detail,
        sqsMessageId: "msg-1",
        receiptHandle: "rh-1",
      });
      expect(deleteMessage).toHaveBeenCalledWith({
        client: sqsClient,
        queueUrl: baseConfig.queueUrl,
        receiptHandle: "rh-1",
      });
    });

    it("logs and deletes invalid JSON body without delivering to agent", async () => {
      const deliverToAgent = vi.fn();
      const runtime = createMockRuntime();
      const sqsClient = createMockSqsClient();

      const messages: PollResult[] = [
        {
          messageId: "msg-bad",
          receiptHandle: "rh-bad",
          body: "not valid json as an object",
          approximateReceiveCount: 1,
        },
      ];

      await handleInboundBatch({
        messages,
        config: baseConfig,
        runtime,
        sqsClient,
        deliverToAgent,
      });

      expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("invalid body"));
      expect(deleteMessage).toHaveBeenCalledWith({
        client: sqsClient,
        queueUrl: baseConfig.queueUrl,
        receiptHandle: "rh-bad",
      });
      expect(deliverToAgent).not.toHaveBeenCalled();
    });

    it("logs and deletes valid JSON with invalid schema without delivering to agent", async () => {
      const deliverToAgent = vi.fn();
      const runtime = createMockRuntime();
      const sqsClient = createMockSqsClient();

      const messages: PollResult[] = [
        {
          messageId: "msg-schema",
          receiptHandle: "rh-schema",
          body: { detail: { notValid: true } },
          approximateReceiveCount: 1,
        },
      ];

      await handleInboundBatch({
        messages,
        config: baseConfig,
        runtime,
        sqsClient,
        deliverToAgent,
      });

      expect(runtime.log).toHaveBeenCalledWith(
        expect.stringContaining("envelope validation failed"),
      );
      expect(deleteMessage).toHaveBeenCalledWith({
        client: sqsClient,
        queueUrl: baseConfig.queueUrl,
        receiptHandle: "rh-schema",
      });
      expect(deliverToAgent).not.toHaveBeenCalled();
    });

    it("logs and deletes message from unauthorized sender without delivering to agent", async () => {
      createDenyResolver();
      const deliverToAgent = vi.fn();
      const runtime = createMockRuntime();
      const sqsClient = createMockSqsClient();

      const unauthorizedBody = {
        ...validEnvelopeBody,
        detail: {
          ...validEnvelopeBody.detail,
          source: "evil.hacker",
        },
      };

      const messages: PollResult[] = [
        {
          messageId: "msg-unauth",
          receiptHandle: "rh-unauth",
          body: unauthorizedBody,
          approximateReceiveCount: 1,
        },
      ];

      await handleInboundBatch({
        messages,
        config: { ...baseConfig, allowFrom: ["myapp.orders"] },
        runtime,
        sqsClient,
        deliverToAgent,
      });

      expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("unauthorized source"));
      expect(deleteMessage).toHaveBeenCalledWith({
        client: sqsClient,
        queueUrl: baseConfig.queueUrl,
        receiptHandle: "rh-unauth",
      });
      expect(deliverToAgent).not.toHaveBeenCalled();
    });

    it("calls statusSink on successful inbound delivery", async () => {
      createAllowResolver();
      const deliverToAgent = vi.fn().mockResolvedValue(undefined);
      const statusSink = vi.fn();
      const runtime = createMockRuntime();
      const sqsClient = createMockSqsClient();

      const messages: PollResult[] = [
        {
          messageId: "msg-status",
          receiptHandle: "rh-status",
          body: validEnvelopeBody,
          approximateReceiveCount: 1,
        },
      ];

      await handleInboundBatch({
        messages,
        config: baseConfig,
        runtime,
        sqsClient,
        deliverToAgent,
        statusSink,
      });

      expect(statusSink).toHaveBeenCalledTimes(1);
      expect(statusSink).toHaveBeenCalledWith({ lastInboundAt: expect.any(Number) });
    });

    it("does not call statusSink for invalid or unauthorized messages", async () => {
      createDenyResolver();
      const deliverToAgent = vi.fn();
      const statusSink = vi.fn();
      const runtime = createMockRuntime();
      const sqsClient = createMockSqsClient();

      const messages: PollResult[] = [
        {
          messageId: "msg-1",
          receiptHandle: "rh-1",
          body: "not an object",
          approximateReceiveCount: 1,
        },
        {
          messageId: "msg-2",
          receiptHandle: "rh-2",
          body: {
            ...validEnvelopeBody,
            detail: { ...validEnvelopeBody.detail, source: "unauthorized.source" },
          },
          approximateReceiveCount: 1,
        },
      ];

      await handleInboundBatch({
        messages,
        config: baseConfig,
        runtime,
        sqsClient,
        deliverToAgent,
        statusSink,
      });

      expect(statusSink).not.toHaveBeenCalled();
    });
  });
});
