# Implementation Plan: EventBridge Channel Plugin

## Overview

Implement an OpenClaw channel plugin at `extensions/eventbridge/` that enables agents to send and receive structured events on AWS EventBridge buses via SQS-backed polling. The plugin follows the passive-account lifecycle pattern (like IRC/Matrix), using `runStoppablePassiveMonitor` for clean start/stop semantics, and remains strictly transport-only per the channel contract.

Implementation proceeds bottom-up: shared types and helpers first, then core modules (envelope, config, credentials, backoff), then inbound/outbound adapters, then the gateway lifecycle wiring, and finally the plugin entry/manifest that ties everything together.

## Tasks

- [x] 1. Set up project structure and shared types
  - [x] 1.1 Create `extensions/eventbridge/package.json` and `extensions/eventbridge/tsconfig.json`
    - Add `package.json` with dependencies: `@aws-sdk/client-sqs`, `@aws-sdk/client-eventbridge`, `@aws-sdk/credential-provider-node`, `zod`
    - Add `fast-check` as a dev dependency
    - Use the same `tsconfig.json` pattern as `extensions/irc/tsconfig.json`
    - _Requirements: 1.1, 5.1_

  - [x] 1.2 Create `extensions/eventbridge/src/types.ts` with shared internal types
    - Define `ResolvedEventBridgeConfig`, `EventBridgeRuntimeSnapshot`, `PollResult`, `InboundEventContext`
    - Export shared type aliases used across modules
    - _Requirements: 6.1, 6.2_

- [ ] 2. Implement configuration and validation
  - [ ] 2.1 Implement `extensions/eventbridge/src/config-schema.ts`
    - Define `EventBridgeConfigSchema` with zod: `queueUrl` (required), optional `busName`, `busArn`, `sourceNamespace`, `region`, `pollIntervalMs`, `maxMessages`, `waitTimeSeconds`, `dmPolicy`, `allowFrom`
    - Use `DmPolicySchema`, `buildChannelConfigSchema`, `requireOpenAllowFrom` from plugin SDK
    - Apply `.strict()` and `.superRefine()` for cross-field validation
    - _Requirements: 6.1, 6.2, 6.3, 8.1, 8.2_

  - [ ]* 2.2 Write property test for config schema validation
    - **Property 6: Config schema accepts valid optional field combinations**
    - Generate random valid `queueUrl` + arbitrary subsets of optional fields within constraints
    - Assert `EventBridgeConfigSchema.safeParse` succeeds for all valid combinations
    - **Validates: Requirements 6.2**

  - [ ]* 2.3 Write unit tests for `config-schema.ts`
    - Test required field rejection (missing `queueUrl`)
    - Test `dmPolicy` / `allowFrom` cross-validation (`open` requires `*` in `allowFrom`)
    - Test boundary values for `maxMessages` (1–10), `waitTimeSeconds` (0–20), `pollIntervalMs` (0–60000)
    - _Requirements: 6.3, 6.4_

- [ ] 3. Implement Signal Envelope schema
  - [ ] 3.1 Implement `extensions/eventbridge/src/envelope.ts`
    - Define `SignalEnvelopeSchema` with zod: `source`, `detailType`, `correlationId`, `causationId`, `payload`, `metadata`
    - Implement `wrapOutboundEnvelope` (returns validated envelope or null)
    - Implement `parseInboundEnvelope` (returns `{ ok, envelope }` or `{ ok, error }`)
    - _Requirements: 4.1, 4.3_

  - [ ]* 3.2 Write property test for inbound envelope round-trip
    - **Property 2: Inbound envelope parsing extracts valid Signal Envelope**
    - Generate random valid `SignalEnvelope` objects, wrap in EventBridge-to-SQS body structure
    - Assert `parseInboundEnvelope(body.detail)` returns `{ ok: true }` with structurally equivalent envelope
    - **Validates: Requirements 2.3, 4.3**

  - [ ]* 3.3 Write property test for invalid envelope rejection
    - **Property 3: Invalid envelope rejection**
    - Generate arbitrary objects missing required fields, wrong types, or malformed structure
    - Assert `parseInboundEnvelope` returns `{ ok: false, error }` with non-empty error string
    - **Validates: Requirements 4.2**

  - [ ]* 3.4 Write unit tests for `envelope.ts`
    - Test `wrapOutboundEnvelope` returns null for invalid params
    - Test `parseInboundEnvelope` with edge cases: empty object, null, missing `correlationId`
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 4. Implement backoff and credentials helpers
  - [ ] 4.1 Implement `extensions/eventbridge/src/backoff.ts`
    - `createExponentialBackoff` with configurable `baseMs` (default 1000), `maxMs` (default 30000), `jitterFraction` (default 0.2)
    - Returns `{ next(), reset() }` interface
    - _Requirements: 7.4, 10.1_

  - [ ]* 4.2 Write property test for exponential backoff growth
    - **Property 7: Exponential backoff growth**
    - Generate random retry sequences (N ≥ 2), assert monotonic growth up to max
    - Assert each delay bounded by `min(baseMs * 2^(N-1), maxMs) ± jitter`
    - **Validates: Requirements 7.4, 10.1**

  - [ ] 4.3 Implement `extensions/eventbridge/src/credentials.ts`
    - `buildAwsCredentials` using `fromNodeProviderChain`
    - Region resolution: explicit config → `AWS_REGION` → `AWS_DEFAULT_REGION` → `"us-east-1"`
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 4.4 Write property test for region resolution priority
    - **Property 5: Region resolution priority**
    - Generate random combinations of explicit region, `AWS_REGION`, `AWS_DEFAULT_REGION` (present/absent)
    - Assert priority order: explicit > `AWS_REGION` > `AWS_DEFAULT_REGION` > `"us-east-1"`
    - **Validates: Requirements 5.3**

  - [ ]* 4.5 Write unit tests for `backoff.ts` and `credentials.ts`
    - Test backoff reset returns to initial delay
    - Test credentials with no env/config uses `us-east-1` fallback
    - Test credentials stores no secrets in returned config
    - _Requirements: 5.3, 5.4, 7.4_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement SQS poller
  - [ ] 6.1 Implement `extensions/eventbridge/src/poller.ts`
    - `runSqsPoller` with long-poll loop respecting `abortSignal`
    - Uses `ReceiveMessageCommand` with configured `MaxNumberOfMessages` and `WaitTimeSeconds`
    - Calls `callbacks.onMessages` for received messages, `callbacks.onError` on failures
    - Integrates exponential backoff from `backoff.ts` on transient errors
    - `deleteMessage` helper for post-processing cleanup
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 10.1, 10.4_

  - [ ]* 6.2 Write property test for poller config fidelity
    - **Property 1: Poller config fidelity**
    - Generate random valid `maxMessages` (1–10) and `waitTimeSeconds` (0–20)
    - Mock SQS client, assert `ReceiveMessageCommand` input contains exactly those values
    - **Validates: Requirements 2.1, 2.6**

  - [ ]* 6.3 Write unit tests for `poller.ts`
    - Test abort signal stops the poll loop cleanly
    - Test backoff is called on SQS errors
    - Test `deleteMessage` calls `DeleteMessageCommand` with correct receipt handle
    - Test `statusSink` is called with `lastInboundAt` on messages
    - _Requirements: 2.2, 2.5, 2.7, 7.2_

- [ ] 7. Implement inbound processing and ingress
  - [ ] 7.1 Implement `extensions/eventbridge/src/inbound.ts`
    - `handleInboundBatch`: parse SQS body → extract `detail` → validate as SignalEnvelope → resolve ingress → deliver or drop
    - Define `eventbridgeIngressIdentity` using `defineStableChannelIngressIdentity` with `source` as sender key
    - Use `createChannelIngressResolver` for access control decisions
    - Delete messages after processing (success or invalid/unauthorized)
    - _Requirements: 2.3, 2.4, 2.5, 4.2, 4.3, 8.3, 8.4_

  - [ ]* 7.2 Write property test for unauthorized event filtering
    - **Property 8: Unauthorized event filtering**
    - Generate random `source` values not in configured `allowFrom` list (with `dmPolicy: "allowlist"`)
    - Assert ingress resolver denies and plugin does not deliver to agent
    - **Validates: Requirements 8.4**

  - [ ]* 7.3 Write unit tests for `inbound.ts`
    - Test valid envelope is delivered to agent after ingress approval
    - Test invalid JSON body is logged and deleted (not requeued)
    - Test valid JSON but invalid schema is logged and deleted
    - Test unauthorized sender is logged and deleted
    - Test `statusSink` updated on successful inbound delivery
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 4.2, 8.4_

- [ ] 8. Implement outbound adapter
  - [ ] 8.1 Implement `extensions/eventbridge/src/outbound.ts`
    - `sendEventBridgeOutbound` wrapping payload in Signal Envelope and calling `PutEventsCommand`
    - Implement `sendText` and `sendMedia` per `ChannelOutboundAdapter` contract
    - `sendMedia` references media by URL in payload (no inline binary)
    - On partial failure (`FailedEntryCount > 0`), re-send entire batch once
    - Reject message if envelope wrapping fails (do not send unwrapped)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 10.2, 10.3_

  - [ ]* 8.2 Write property test for outbound envelope correctness
    - **Property 4: Outbound envelope correctness**
    - Generate random valid `sourceNamespace`, `detailType`, `correlationId` UUID, optional `causationId`, message text (and text + mediaUrl)
    - Assert `PutEvents` entry has correct `Source`, `DetailType`, and `Detail` containing all envelope fields
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6**

  - [ ]* 8.3 Write unit tests for `outbound.ts`
    - Test partial failure triggers single retry
    - Test full failure logs with event context (no retry)
    - Test `sendMedia` includes URL reference, not binary
    - Test envelope wrapping failure rejects the message
    - _Requirements: 3.1, 3.6, 10.2, 10.3_

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement probe and gateway lifecycle
  - [ ] 10.1 Implement `extensions/eventbridge/src/probe.ts`
    - `probeEventBridge` sends a lightweight `ReceiveMessage` (waitTimeSeconds=0, maxMessages=1) to verify SQS accessibility
    - Returns `{ ok, queueUrl, error?, latencyMs? }`
    - _Requirements: 11.1, 11.2_

  - [ ]* 10.2 Write unit tests for `probe.ts`
    - Test successful probe returns `ok: true` with latency
    - Test failed probe returns `ok: false` with error message
    - _Requirements: 11.2, 11.3_

  - [ ] 10.3 Implement `extensions/eventbridge/src/gateway.ts`
    - `startEventBridgeGatewayAccount` orchestrates lifecycle:
      - Validates config, builds AWS clients (SQS + EventBridge)
      - Uses `runStoppablePassiveMonitor` to manage poll loop
      - Reports status snapshots (`configured`, `running`, `lastInboundAt`, `lastOutboundAt`, `lastError`)
      - Respects `ctx.abortSignal` for graceful shutdown
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 9.1, 9.2_

  - [ ]* 10.4 Write unit tests for `gateway.ts`
    - Test abort signal triggers clean shutdown
    - Test status snapshot reports configured/running state
    - Test invalid config surfaces status issues (not silent failure)
    - _Requirements: 7.2, 7.3, 6.4_

- [ ] 11. Implement plugin entry, manifest, and channel wiring
  - [ ] 11.1 Create `extensions/eventbridge/openclaw.plugin.json`
    - Declare `"channels": ["eventbridge"]`
    - Declare `channelEnvVars` with `EVENTBRIDGE_QUEUE_URL`, `EVENTBRIDGE_BUS_NAME`, `AWS_REGION`
    - Set `"activation": { "onStartup": false }`
    - _Requirements: 1.1, 1.5_

  - [ ] 11.2 Implement `extensions/eventbridge/index.ts` using `defineBundledChannelEntry`
    - Register plugin id `"eventbridge"`, name `"EventBridge"`
    - Point plugin specifier to `./channel-plugin-api.js` and runtime to `./runtime-api.js`
    - _Requirements: 1.2_

  - [ ] 11.3 Implement `extensions/eventbridge/channel-plugin-api.ts` and `extensions/eventbridge/src/channel.ts`
    - `channel.ts`: use `createChatChannelPlugin` with `deliveryMode: "direct"`, register `sendText`/`sendMedia`, gateway lifecycle, probe, config schema
    - `channel-plugin-api.ts`: re-export `eventbridgePlugin`
    - _Requirements: 1.2, 3.5, 12.1, 12.2, 12.3, 12.4_

  - [ ] 11.4 Implement `extensions/eventbridge/runtime-api.ts`, `extensions/eventbridge/api.ts`, `extensions/eventbridge/configured-state.ts`
    - `runtime-api.ts`: runtime injection barrel (`setEventBridgeRuntime`)
    - `api.ts`: public API barrel exporting `SignalEnvelopeSchema` and envelope types
    - `configured-state.ts`: `hasConfiguredState` check for activation gating
    - _Requirements: 1.3, 1.4, 4.4_

  - [ ] 11.5 Create `extensions/eventbridge/src/runtime.ts`
    - Runtime singleton accessor pattern (per existing plugins)
    - _Requirements: 7.1_

- [ ] 12. Integration wiring and final validation
  - [ ] 12.1 Wire all components together in `gateway.ts` and `channel.ts`
    - Connect poller → inbound → ingress → agent delivery path
    - Connect agent response → outbound → PutEvents path
    - Ensure status sink updates propagate from poller/outbound to gateway snapshot
    - Verify plugin activates only when `channels.eventbridge` is configured
    - _Requirements: 1.3, 1.4, 2.4, 2.7, 3.5, 7.1, 7.3, 9.1, 9.2, 9.3, 11.1, 11.4_

  - [ ]* 12.2 Write integration tests for end-to-end flows
    - Test SQS → Plugin → Agent delivery path with mocked SQS client
    - Test Agent → Plugin → EventBridge emission path with mocked EB client
    - Test plugin does not activate without explicit `channels.eventbridge` config
    - Test no background timers beyond the poll loop itself
    - _Requirements: 1.3, 1.4, 9.2, 12.1_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Move `.kiro` spec to `.local` for local-only retention
  - Move `.kiro/specs/eventbridge-channel-plugin/` to `.local/specs/eventbridge-channel-plugin/`
  - Ensure `.local/` is in `.gitignore` (or `.git/info/exclude`) so it stays out of git
  - Verify the spec files are preserved locally but no longer tracked by git
  - _Rationale: Keep the spec as a local working record without polluting the repo history_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 8 universal correctness properties from the design document using `fast-check`
- Unit tests validate specific examples and edge cases
- All tests colocated per repo convention (`*.test.ts` next to source)
- AWS SDK clients mocked at the command level (mock `send` method)
- Plugin remains transport-only: no payload interpretation, no slash commands, no interactive surfaces

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "4.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "3.4", "4.2", "4.4", "4.5"] },
    { "id": 3, "tasks": ["6.1", "7.1", "8.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "7.2", "7.3", "8.2", "8.3"] },
    { "id": 5, "tasks": ["10.1", "10.3"] },
    { "id": 6, "tasks": ["10.2", "10.4", "11.1", "11.2"] },
    { "id": 7, "tasks": ["11.3", "11.4", "11.5"] },
    { "id": 8, "tasks": ["12.1"] },
    { "id": 9, "tasks": ["12.2"] }
  ]
}
```
