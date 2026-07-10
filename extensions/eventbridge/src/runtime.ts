// EventBridge plugin module implements runtime behavior.
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "./runtime-api.js";

const {
  setRuntime: setEventBridgeRuntime,
  clearRuntime: clearStoredEventBridgeRuntime,
  getRuntime: getEventBridgeRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "eventbridge",
  errorMessage: "EventBridge runtime not initialized",
});
export { getEventBridgeRuntime, setEventBridgeRuntime };
export function clearEventBridgeRuntime() {
  clearStoredEventBridgeRuntime();
}
