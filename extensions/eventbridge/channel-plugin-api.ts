// Keep bundled channel entry imports narrow so bootstrap/discovery paths do
// not drag EventBridge runtime/send/monitor surfaces into lightweight plugin loads.
export { eventbridgePlugin } from "./src/channel.js";
