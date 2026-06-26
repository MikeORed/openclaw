# Project Structure

## Top-Level Layout

```
src/              Core TypeScript source (gateway, agents, CLI, channels, plugins, tools)
extensions/       Plugins — providers, channels, tools, skills (each is a workspace package)
packages/         Shared internal libraries (workspace packages)
ui/               Control UI (web frontend)
docs/             Source documentation (published to docs.openclaw.ai)
apps/             Companion app code
scripts/          Build, CI, and utility scripts
test/             Test infrastructure and helpers
qa/               QA scenarios (YAML only)
config/           Shared configuration files
deploy/           Deployment configs (Docker, Fly, Render)
patches/          pnpm dependency patches
skills/           Bundled workspace skills
security/         Security-related configs/policies
```

## Core Source (`src/`)

| Directory | Purpose |
|-----------|---------|
| `agents/` | Agent runtime, sessions, harnesses, model routing |
| `channels/` | Channel abstraction layer (transport-only) |
| `cli/` | CLI commands and gateway lifecycle |
| `config/` | Configuration loading/schema/mutations |
| `gateway/` | Gateway server, protocol handling |
| `hooks/` | Hook system (bundled hooks) |
| `mcp/` | MCP server/tool integration |
| `plugins/` | Plugin loader, runtime, discovery, SDK alias |
| `plugin-sdk/` | Plugin SDK surface (public API for extensions) |
| `tools/` | Built-in agent tools |
| `state/` | State/storage management |
| `secrets/` | Secret resolution and storage |
| `security/` | Security runtime (SSRF, sandboxing) |
| `auto-reply/` | Reply pipeline and provider dispatch |
| `llm/` | LLM interaction layer |
| `memory/` | Memory/RAG system |
| `media/` | Media handling and storage |

## Packages (`packages/`)

Shared libraries consumed by core and extensions:
- `agent-core` — Agent loop, harness, session management
- `gateway-protocol` — Gateway RPC protocol schemas
- `gateway-client` — Gateway WebSocket client
- `llm-core` / `llm-runtime` — LLM types and streaming
- `model-catalog-core` — Provider/model catalog and normalization
- `media-core` / `media-generation-core` — Media types and generation
- `markdown-core` — Markdown parsing/rendering
- `normalization-core` — String/number coercion utilities
- `acp-core` — Agent Client Protocol types
- `terminal-core` — CLI terminal styling/prompts
- `net-policy` — Network/SSRF policy
- `web-content-core` — Web content extraction
- `speech-core` — TTS/STT types

## Extensions (`extensions/`)

Each extension is a self-contained workspace package. Categories:
- **Providers**: `openai/`, `anthropic/`, `google/`, `ollama/`, `deepseek/`, `groq/`, etc.
- **Channels**: `telegram/`, `discord/`, `slack/`, `whatsapp/`, `signal/`, `matrix/`, etc.
- **Tools/Skills**: `browser/`, `canvas/`, `memory-core/`, `webhooks/`, etc.

Plugins access core via `openclaw/plugin-sdk` and `openclaw/plugin-sdk/*` imports only.

## Key Architecture Rules
- Core is plugin-agnostic; no bundled plugin IDs/defaults in core
- Plugins cross into core only via `openclaw/plugin-sdk/*`, manifest metadata, or injected helpers
- Plugin prod code must not import from core `src/**` or other plugin `src/**`
- Owner-specific behavior lives in the owner plugin, not core
- Gateway protocol changes must be additive; breaking changes need versioning
