# Product Overview

OpenClaw is a personal AI assistant gateway you self-host on your own devices. It connects to the messaging channels you already use (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, IRC, Teams, Matrix, and many more) and routes conversations through configurable AI model providers.

Key characteristics:
- Single-user, local-first personal assistant (not a SaaS product)
- Multi-channel inbox: one gateway, many messaging surfaces
- Multi-agent routing: isolated agents per channel/account/peer
- Extensible plugin architecture for providers, channels, tools, and skills
- Companion apps for macOS, iOS, Android, and Windows
- Voice support (wake words, talk mode, TTS)
- Live Canvas for visual agent-driven workspaces
- CLI-driven setup via `openclaw onboard`

Product naming: use "OpenClaw" in docs/UI/user-visible text. Use `openclaw` for CLI, package names, paths, and config keys. Messaging integrations are called "plugins" in user-facing contexts; `extensions/` is the internal directory name.
