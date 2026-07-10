// Module-scoped status sink for outbound sends.
// Set by the gateway lifecycle when startAccount runs, cleared on stop.
// Allows standalone outbound adapter calls to propagate lastOutboundAt
// back to the gateway snapshot without coupling to ChannelGatewayContext.

type OutboundStatusPatch = { lastOutboundAt?: number };

let sink: ((patch: OutboundStatusPatch) => void) | null = null;

/** Called by gateway lifecycle to wire outbound status propagation. */
export function setOutboundStatusSink(next: ((patch: OutboundStatusPatch) => void) | null): void {
  sink = next;
}

/** Returns the current outbound status sink, or undefined if not wired. */
export function getOutboundStatusSink(): ((patch: OutboundStatusPatch) => void) | undefined {
  return sink ?? undefined;
}
