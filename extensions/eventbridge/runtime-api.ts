// Keep the bundled runtime entry narrow so generic runtime activation does not
// import the broad EventBridge API barrel just to install runtime state.
export { setEventBridgeRuntime } from "./src/runtime.js";
