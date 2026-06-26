# Tech Stack & Build System

## Runtime
- Node.js 24 (recommended), minimum 22.19+
- TypeScript ESM, strict mode, target ES2023
- Module resolution: NodeNext

## Package Management
- pnpm (monorepo workspace)
- Workspace packages: root, `ui/`, `packages/*`, `extensions/*`
- Do NOT use `npm install` at root for development

## Build Tooling
- **tsdown** (Rolldown-based bundler) for production builds
- **tsgo** for type checking (not `tsc --noEmit`)
- **oxfmt** for formatting (not Prettier)
- **oxlint** for linting
- **Vitest** for testing

## Key Libraries
- zod for schema validation at external boundaries
- Kysely for SQLite access (no raw SQL except DDL/migrations)
- typebox for JSON schema (gateway protocol, tool schemas)
- hono for HTTP server framework
- ws for WebSocket

## Common Commands

| Task | Command |
|------|---------|
| Install dependencies | `pnpm install` |
| Build all | `pnpm build` |
| Dev loop (auto-reload) | `pnpm gateway:watch` |
| Run CLI | `pnpm openclaw ...` or `pnpm dev` |
| Run tests (file/filter) | `pnpm test <path-or-filter>` |
| Run changed tests | `pnpm test:changed` |
| Type check | `pnpm tsgo` (lanes only) |
| Lint | `pnpm lint` (use scoped `lint:*` when possible) |
| Format | `pnpm format:*` |
| Check changed | `pnpm check:changed` |
| Extension tests | `pnpm test:extensions` |
| Build UI | `pnpm ui:build` |
| UI dev | `pnpm ui:dev` |

## Code Conventions
- TypeScript ESM with strict mode; avoid `any`, prefer `unknown` or narrow types
- No `@ts-nocheck`; lint suppressions require explanation
- Prefer discriminated unions over freeform strings for runtime branching
- Use early returns over nested conditions
- Prefer `zod` or existing schema helpers at external boundaries
- Dynamic imports use `*.runtime.ts` lazy boundary pattern
- Colocated tests: `*.test.ts` next to source; e2e: `*.e2e.test.ts`
- American English spelling
- Split files around ~700 LOC when it improves clarity
- Storage: SQLite only for runtime state (no JSON/JSONL sidecar files)
- Commits via `scripts/committer "<msg>" <file...>`
