// EventBridge plugin entrypoint registers its OpenClaw integration.
import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "eventbridge",
  name: "EventBridge",
  description: "AWS EventBridge channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "eventbridgePlugin",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setEventBridgeRuntime",
  },
});
