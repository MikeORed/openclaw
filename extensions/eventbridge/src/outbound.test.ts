import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./envelope.js", () => ({
  wrapOutboundEnvelope: vi.fn(),
}));

import { wrapOutboundEnvelope } from "./envelope.js";
import { sendEventBridgeOutbound, sendText, sendMedia } from "./outbound.js";

function createMockClient() {
  return { send: vi.fn() } as any;
}

describe("outbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock passes through the input params (simulating successful envelope creation)
    vi.mocked(wrapOutboundEnvelope).mockImplementation((params) => ({
      source: params.source,
      detailType: params.detailType,
      correlationId: params.correlationId,
      causationId: params.causationId,
      payload: params.payload,
      metadata: params.metadata,
    }));
  });

  describe("sendEventBridgeOutbound", () => {
    it("partial failure triggers single retry", async () => {
      const client = createMockClient();
      // First call: partial failure
      client.send.mockResolvedValueOnce({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: "InternalError" }],
      });
      // Second call (retry): success
      client.send.mockResolvedValueOnce({
        FailedEntryCount: 0,
        Entries: [{ EventId: "evt-retry-ok" }],
      });

      const result = await sendEventBridgeOutbound({
        client,
        source: "openclaw.agent",
        detailType: "AgentMessage",
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
        payload: { text: "hello" },
      });

      expect(client.send).toHaveBeenCalledTimes(2);
      expect(result.eventId).toBe("evt-retry-ok");
    });

    it("full failure propagates error without retry", async () => {
      const client = createMockClient();
      const error = new Error("EventBridge service unavailable");
      client.send.mockRejectedValueOnce(error);

      await expect(
        sendEventBridgeOutbound({
          client,
          source: "openclaw.agent",
          detailType: "AgentMessage",
          correlationId: "550e8400-e29b-41d4-a716-446655440000",
          payload: { text: "hello" },
        }),
      ).rejects.toThrow("EventBridge service unavailable");

      // Only one call — no retry on full failure
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it("envelope wrapping failure rejects without calling PutEvents", async () => {
      vi.mocked(wrapOutboundEnvelope).mockReturnValue(null);
      const client = createMockClient();

      await expect(
        sendEventBridgeOutbound({
          client,
          source: "",
          detailType: "AgentMessage",
          correlationId: "not-a-uuid",
          payload: { text: "hello" },
        }),
      ).rejects.toThrow("envelope wrapping failed");

      expect(client.send).not.toHaveBeenCalled();
    });
  });

  describe("sendMedia", () => {
    it("includes mediaUrl as URL reference, not binary", async () => {
      // Return envelope that reflects the media payload
      vi.mocked(wrapOutboundEnvelope).mockReturnValue({
        source: "openclaw.agent",
        detailType: "AgentMedia",
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
        payload: { text: "check this image", mediaUrl: "https://cdn.example.com/image.png" },
      });

      const client = createMockClient();
      client.send.mockResolvedValueOnce({
        FailedEntryCount: 0,
        Entries: [{ EventId: "evt-media" }],
      });

      await sendMedia({
        client,
        sourceNamespace: "openclaw.agent",
        text: "check this image",
        mediaUrl: "https://cdn.example.com/image.png",
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
      });

      expect(client.send).toHaveBeenCalledTimes(1);

      // Inspect the PutEventsCommand input
      const commandArg = client.send.mock.calls[0]![0];
      const entry = commandArg.input.Entries[0];
      const detail = JSON.parse(entry.Detail);

      // mediaUrl is a string URL reference, not binary data
      expect(detail.payload.mediaUrl).toBe("https://cdn.example.com/image.png");
      expect(typeof detail.payload.mediaUrl).toBe("string");
      // Payload also contains text
      expect(detail.payload.text).toBe("check this image");
    });
  });
});
