# Requirements Document

## Introduction

An OpenClaw channel plugin that enables agents to send and receive structured events on AWS EventBridge buses via SQS-backed polling, allowing agents to operate as signal processors in event-driven architectures.

OpenClaw agents currently interact through human-facing channels (Telegram, Discord, Slack, etc.). There is no machine-to-machine transport for event-driven coordination. An EventBridge channel enables agents to consume events from AWS infrastructure, other agents, or services — and emit structured signals back — turning agents into first-class participants in event-driven architectures.

This benefits any OpenClaw user running on AWS who wants:
- Agents that react to infrastructure events (CloudWatch alarms, CodePipeline state changes, custom app events)
- Multi-agent coordination via a shared bus
- Integration with existing AWS event-driven architectures without custom webhooks

## Glossary

- **Plugin**: An OpenClaw extension that registers via `openclaw.plugin.json` manifest and activates through the plugin SDK
- **Channel**: A transport-only communication surface that delivers messages between external systems and OpenClaw agents
- **EventBridge**: AWS EventBridge, an event bus service for routing structured events between AWS services and applications
- **SQS**: AWS Simple Queue Service, used here as the inbound polling surface for events routed from EventBridge rules
- **Signal_Envelope**: The typed schema wrapping all events sent and received by the plugin, containing source, detailType, correlationId, causationId, payload, and metadata
- **Inbound_Polling**: The process of receiving messages from SQS via long-polling in a continuous loop
- **Outbound_Adapter**: The component implementing `ChannelOutboundAdapter` to emit events onto an EventBridge bus via `PutEvents`
- **Ingress_Resolver**: The access control mechanism (`createChannelIngressResolver`) that determines whether inbound events are authorized for processing
- **Passive_Account_Lifecycle**: The OpenClaw lifecycle pattern using `runStoppablePassiveMonitor` for connection-based channel plugins
- **Status_Sink**: The mechanism for reporting plugin operational state through OpenClaw's standard status adapters

## Requirements

### Requirement 1: Plugin Registration and Discovery

**User Story:** As an OpenClaw platform operator, I want the EventBridge plugin to register as a standard channel plugin, so that it is discoverable and activates only when configured.

#### Acceptance Criteria

1. THE Plugin SHALL declare `"channels": ["eventbridge"]` in `openclaw.plugin.json`
2. THE Plugin SHALL use `defineBundledChannelEntry(...)` for entry registration
3. WHEN `channels.eventbridge` is explicitly configured in `openclaw.json`, THE Plugin SHALL activate; environment variables or default settings alone SHALL NOT trigger activation
4. WHILE `channels.eventbridge` is not explicitly configured in `openclaw.json`, THE Plugin SHALL be entirely prevented from activating (not just disabling eventbridge-specific functionality)
5. THE Plugin SHALL declare environment variable auto-detection via `channelEnvVars` for at minimum `EVENTBRIDGE_QUEUE_URL`

### Requirement 2: SQS Inbound Polling

**User Story:** As an OpenClaw agent operator, I want the plugin to poll an SQS queue for inbound messages routed from EventBridge rules, so that agents can receive and process structured events.

#### Acceptance Criteria

1. THE Inbound_Polling SHALL use SQS `ReceiveMessage` with long-polling (`WaitTimeSeconds` configurable, default 20s)
2. THE Inbound_Polling SHALL poll in a loop respecting `ctx.abortSignal` for clean shutdown
3. WHEN an SQS message is received, THE Plugin SHALL parse the message body as an EventBridge event envelope
4. WHEN a valid event envelope is parsed, THE Plugin SHALL extract the signal payload and route it through the Ingress_Resolver
5. WHEN a message is successfully processed, THE Plugin SHALL delete the message from SQS
6. THE Inbound_Polling SHALL support configurable batch size (`maxMessages`, default 10)
7. THE Plugin SHALL report inbound activity via the Status_Sink

### Requirement 3: EventBridge Outbound (PutEvents)

**User Story:** As an OpenClaw agent operator, I want the plugin to emit agent responses and signals onto an EventBridge bus, so that other systems can consume agent output as structured events.

#### Acceptance Criteria

1. WHEN an outbound message is sent, THE Outbound_Adapter SHALL wrap the message in the Signal_Envelope schema; IF envelope wrapping fails, THEN THE Outbound_Adapter SHALL reject the message (not send it unwrapped)
2. THE Outbound_Adapter SHALL scope the `Source` field to the agent's configured namespace (e.g., `openclaw.sre`)
3. THE Outbound_Adapter SHALL support configurable `DetailType` per message or derived from context
4. THE Outbound_Adapter SHALL include `correlationId` and `causationId` in events for traceability
5. THE Outbound_Adapter SHALL implement the `ChannelOutboundAdapter` contract (`sendText`, `sendMedia`)
6. WHEN media attachments are sent, THE Outbound_Adapter SHALL reference them by URL in the event payload (not inline binary)

### Requirement 4: Signal Envelope Schema

**User Story:** As a developer integrating with OpenClaw agents via EventBridge, I want a typed signal envelope schema for all events, so that producers and consumers can validate event structure.

#### Acceptance Criteria

1. THE Signal_Envelope SHALL include: `source`, `detailType`, `correlationId`, `causationId`, `payload`, `metadata`
2. WHEN an inbound event does not conform to the Signal_Envelope, THE Plugin SHALL log the event and route it to error handling (not silently drop it)
3. THE Plugin SHALL validate the Signal_Envelope via zod at the plugin boundary for all events regardless of whether they are already known to conform to the schema
4. THE Plugin SHALL export the Signal_Envelope schema from the plugin's public API barrel for external consumers

### Requirement 5: AWS Credential Management

**User Story:** As an OpenClaw platform operator, I want the plugin to authenticate to AWS using the standard credential chain, so that no secrets are stored in plugin configuration.

#### Acceptance Criteria

1. THE Plugin SHALL use `@aws-sdk/credential-provider-node` (default credential chain)
2. THE Plugin SHALL support: environment variables, shared config/profiles, container credentials, and IMDS
3. THE Plugin SHALL support explicit region configuration with fallback to `AWS_REGION` / `AWS_DEFAULT_REGION`
4. THE Plugin SHALL store no secrets in plugin config; THE Plugin SHALL store at least the necessary ARNs, URLs, or names required for operation

### Requirement 6: Configuration Schema

**User Story:** As an OpenClaw platform operator, I want to configure the EventBridge channel via `openclaw.json` with validation, so that misconfiguration is caught at startup.

#### Acceptance Criteria

1. THE Plugin SHALL require `queueUrl` (SQS queue URL for inbound) as a configuration field
2. THE Plugin SHALL accept optional fields: `busName` or `busArn` (for outbound PutEvents), `sourceNamespace`, `region`, `pollIntervalMs`, `maxMessages`, `waitTimeSeconds`, `dmPolicy`, `allowFrom`
3. THE Plugin SHALL validate configuration via zod schema at startup
4. IF configuration is invalid, THEN THE Plugin SHALL surface clear status issues (not fail silently); status issues MAY also be surfaced when configuration is valid (e.g., connectivity warnings)
5. WHEN configuration prefixes change, THE Plugin SHALL trigger reload via `reload.configPrefixes`

### Requirement 7: Channel Lifecycle Management

**User Story:** As an OpenClaw platform operator, I want the plugin to start, maintain, and cleanly shut down its polling loop, so that the agent gateway manages the plugin lifecycle predictably.

#### Acceptance Criteria

1. THE Plugin SHALL use `runStoppablePassiveMonitor` or equivalent lifecycle primitive
2. THE Plugin SHALL respect `ctx.abortSignal` for graceful shutdown
3. THE Plugin SHALL report status snapshots (`configured`, `running`, `lastInboundAt`, `lastOutboundAt`, `lastError`)
4. IF an SQS connection error occurs, THEN THE Plugin SHALL retry with backoff (not crash-loop)
5. WHEN the gateway restarts, THE Plugin SHALL handle exit cleanly

### Requirement 8: Access Control and Ingress Policy

**User Story:** As an OpenClaw agent operator, I want to control which inbound events are processed, so that unauthorized or unwanted events are filtered before reaching the agent.

#### Acceptance Criteria

1. THE Plugin SHALL support `dmPolicy` configuration (`open`, `pairing`, `allowlist`)
2. THE Plugin SHALL support `allowFrom` for sender filtering (event source patterns or specific sources)
3. THE Plugin SHALL use `createChannelIngressResolver` for access decisions
4. WHEN an inbound event is unauthorized, THE Plugin SHALL log and drop the event (not process it)

### Requirement 9: No Always-On Compute Overhead

**User Story:** As an OpenClaw platform operator, I want the plugin to introduce no significant resource overhead when idle, so that running the EventBridge channel does not increase baseline costs.

#### Acceptance Criteria

1. THE Plugin SHALL use SQS long-polling as the only continuous operation
2. THE Plugin SHALL run no background timers or intervals beyond the poll loop itself, except essential periodic maintenance tasks (e.g., connection health checks) that operate under strict resource limits
3. WHILE idle, THE Plugin SHALL have negligible CPU usage regardless of I/O blocking status

### Requirement 10: Error Resilience

**User Story:** As an OpenClaw agent operator, I want the plugin to handle transient AWS errors without crashing the agent, so that temporary network or service issues do not disrupt agent operation.

#### Acceptance Criteria

1. IF an SQS `ReceiveMessage` call fails, THEN THE Plugin SHALL retry with exponential backoff
2. IF a `PutEvents` call fails, THEN THE Plugin SHALL log the failure with the failed event context
3. IF a `PutEvents` call partially fails (some entries fail), THEN THE Plugin SHALL re-send the entire batch
4. IF a network timeout occurs, THEN THE Plugin SHALL continue the poll loop (not crash)
5. THE Plugin SHALL not manage DLQ-routed messages (infrastructure handles DLQ routing)

### Requirement 11: Observability

**User Story:** As an OpenClaw platform operator, I want the plugin to expose operational state through standard status mechanisms, so that I can monitor plugin health via `openclaw status`.

#### Acceptance Criteria

1. THE Plugin SHALL report via both an active status adapter AND successful status reporting: configured state, running state, connection health, and last activity timestamps
2. THE Plugin SHALL provide a probe adapter that verifies SQS queue accessibility
3. IF an error occurs, THEN THE Plugin SHALL surface the error in `openclaw status` output
4. THE Plugin SHALL follow existing channel status patterns (see IRC/Discord implementations)

### Requirement 12: Transport-Only Boundary

**User Story:** As an OpenClaw plugin SDK consumer, I want the EventBridge channel to remain transport-only, so that product-level behavior stays in agent configuration and is not coupled to the channel implementation.

#### Acceptance Criteria

1. THE Plugin SHALL not interpret event payload semantics beyond Signal_Envelope validation
2. THE Plugin SHALL not own slash commands, menus, or interactive surfaces
3. THE Plugin SHALL render portable presentation/actions per the channel contract
4. THE Plugin SHALL delegate all product-level behavior to the agent configuration (not the channel)

## Out of Scope

- EventBridge rule creation or management (infrastructure concern, handled by CDK/Terraform externally)
- SQS queue creation or configuration (same — external infrastructure)
- Multi-account EventBridge routing (future enhancement)
- Kafka/Kinesis alternative transports (separate plugins if needed)
- HITL approval workflows (agent/governance-layer concern, not transport)
- Signal envelope schema standardization into core SDK (plugin-local for now)

## Dependencies

- `@aws-sdk/client-sqs` — SQS ReceiveMessage/DeleteMessage
- `@aws-sdk/client-eventbridge` — PutEvents
- `@aws-sdk/credential-provider-node` — credential chain
- OpenClaw Plugin SDK (`openclaw/plugin-sdk/*`) — channel contracts, lifecycle, ingress

## References

- `extensions/irc/` — reference implementation for connection-based channel plugin
- `extensions/amazon-bedrock/` — reference for AWS SDK credential patterns
- `src/plugin-sdk/extension-shared.ts` — `runStoppablePassiveMonitor` lifecycle primitive
- `src/plugin-sdk/channel-lifecycle.core.ts` — `runPassiveAccountLifecycle`, `waitUntilAbort`
- `src/channels/plugins/types.plugin.ts` — `ChannelPlugin` type contract
- `.local/Hecatoncheires/project-brief.md` — upstream Hecatoncheires project context
