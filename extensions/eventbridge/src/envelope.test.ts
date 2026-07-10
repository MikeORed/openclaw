// Signal Envelope unit tests.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInboundEnvelope, wrapOutboundEnvelope } from "./envelope.js";

const VALID_PARAMS = {
  source: "myapp.orders",
  detailType: "OrderCreated",
  correlationId: randomUUID(),
  payload: { orderId: "abc-123", amount: 42 },
};

describe("wrapOutboundEnvelope", () => {
  it("returns a valid envelope for valid input", () => {
    const result = wrapOutboundEnvelope(VALID_PARAMS);
    expect(result).not.toBeNull();
    expect(result!.source).toBe(VALID_PARAMS.source);
    expect(result!.detailType).toBe(VALID_PARAMS.detailType);
    expect(result!.correlationId).toBe(VALID_PARAMS.correlationId);
    expect(result!.payload).toEqual(VALID_PARAMS.payload);
  });

  it("returns a valid envelope with optional fields", () => {
    const causationId = randomUUID();
    const metadata = { version: "1.0", region: "us-east-1" };
    const result = wrapOutboundEnvelope({ ...VALID_PARAMS, causationId, metadata });
    expect(result).not.toBeNull();
    expect(result!.causationId).toBe(causationId);
    expect(result!.metadata).toEqual(metadata);
  });

  it("returns null for empty source", () => {
    const result = wrapOutboundEnvelope({ ...VALID_PARAMS, source: "" });
    expect(result).toBeNull();
  });

  it("returns null for empty detailType", () => {
    const result = wrapOutboundEnvelope({ ...VALID_PARAMS, detailType: "" });
    expect(result).toBeNull();
  });

  it("returns null for invalid correlationId (not UUID)", () => {
    const result = wrapOutboundEnvelope({ ...VALID_PARAMS, correlationId: "not-a-uuid" });
    expect(result).toBeNull();
  });

  it("returns null for invalid causationId (not UUID)", () => {
    const result = wrapOutboundEnvelope({
      ...VALID_PARAMS,
      causationId: "also-not-a-uuid",
    });
    expect(result).toBeNull();
  });
});

describe("parseInboundEnvelope", () => {
  it("returns ok: true with envelope for valid input", () => {
    const result = parseInboundEnvelope(VALID_PARAMS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.envelope.source).toBe(VALID_PARAMS.source);
    expect(result.envelope.correlationId).toBe(VALID_PARAMS.correlationId);
  });

  it("returns ok: false with non-empty error for empty object", () => {
    const result = parseInboundEnvelope({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns ok: false with non-empty error for null", () => {
    const result = parseInboundEnvelope(null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns ok: false when correlationId is missing", () => {
    const { correlationId: _, ...noCorrelation } = VALID_PARAMS;
    const result = parseInboundEnvelope(noCorrelation);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns ok: false when correlationId is not a valid UUID", () => {
    const result = parseInboundEnvelope({ ...VALID_PARAMS, correlationId: "bad-id" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns ok: false for undefined input", () => {
    const result = parseInboundEnvelope(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns ok: false when payload is not a record", () => {
    const result = parseInboundEnvelope({ ...VALID_PARAMS, payload: "not-an-object" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.length).toBeGreaterThan(0);
  });
});
