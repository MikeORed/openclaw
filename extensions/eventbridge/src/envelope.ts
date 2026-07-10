// Signal Envelope schema and helpers for EventBridge channel plugin.
import { z } from "zod";

export const SignalEnvelopeSchema = z.object({
  source: z.string().min(1),
  detailType: z.string().min(1),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SignalEnvelope = z.infer<typeof SignalEnvelopeSchema>;

/** Wraps an outbound message into a Signal Envelope. Returns null if wrapping fails. */
export function wrapOutboundEnvelope(params: {
  source: string;
  detailType: string;
  correlationId: string;
  causationId?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): SignalEnvelope | null {
  const result = SignalEnvelopeSchema.safeParse(params);
  return result.success ? result.data : null;
}

/** Parses an inbound event body into a validated Signal Envelope. */
export function parseInboundEnvelope(
  raw: unknown,
): { ok: true; envelope: SignalEnvelope } | { ok: false; error: string } {
  const result = SignalEnvelopeSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, envelope: result.data };
  }
  return { ok: false, error: result.error.message };
}
