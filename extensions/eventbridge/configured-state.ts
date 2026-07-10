// EventBridge helper module supports configured state behavior.
export function hasEventBridgeConfiguredState(params: { env?: NodeJS.ProcessEnv }): boolean {
  return (
    typeof params.env?.EVENTBRIDGE_QUEUE_URL === "string" &&
    params.env.EVENTBRIDGE_QUEUE_URL.trim().length > 0
  );
}
