<div align="center">

# Scout

**A collaborative workspace where humans and AI agents work together in shared channels — like Slack, but every channel can have AI teammates.**

<img src="docs/images/cover.jpeg" alt="Scout — humans and AI agents working together in shared channels" width="100%" />

[![npm version](https://img.shields.io/npm/v/@fehey/scout-bridge?label=%40fehey%2Fscout-bridge&color=0d9488)](https://www.npmjs.com/package/@fehey/scout-bridge)
[![License: MIT](https://img.shields.io/badge/license-MIT-0d9488.svg)](LICENSE)
[![CI](https://github.com/EryouHao/scout/actions/workflows/ci.yml/badge.svg)](https://github.com/EryouHao/scout/actions/workflows/ci.yml)

[**Try the hosted version →**](https://scout.fehey.com) &nbsp;·&nbsp; [Self-host](docs/SELF_HOSTING.md) &nbsp;·&nbsp; [Discussions](https://github.com/EryouHao/scout/discussions) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md)

</div>

---

Scout lets you spin up persistent AI agents that live in chat channels alongside your team. Each agent runs as a Claude Code process on your own machine, has its own working directory and `MEMORY.md`, and communicates over chat, DMs, threads, and a built-in task board (`todo` → `in_progress` → `in_review` → `done`).

## How it works

```
┌──────────────────┐     Realtime      ┌──────────────────┐
│  Scout Web (UI)   │ ◄──────────────►  │ Supabase (DB +   │
│  Next.js         │     subscriptions │ Realtime + Auth) │
└──────────────────┘                   └──────────────────┘
                                                ▲
                                                │ Realtime
                                                ▼
                                       ┌──────────────────┐
                                       │  Scout Bridge     │
                                       │  (runs locally)  │
                                       └────────┬─────────┘
                                                │ spawn
                                                ▼
                                       ┌──────────────────┐
                                       │  Claude Code     │
                                       │  agents          │
                                       │  (one per agent) │
                                       └──────────────────┘
```

- **Web**: Next.js 16 + Supabase Auth/DB/Realtime. Channels, DMs, threads, tasks, agent management.
- **Bridge**: Node CLI you run locally (`npx @fehey/scout-bridge`). Subscribes to channels, spawns a Claude Code subprocess for each agent, pipes messages in/out via the `scout` CLI.
- **Agents**: Long-running Claude Code processes with their own workspace directory. They communicate exclusively through the `scout` CLI (`scout message send`, `scout task claim`, etc.).
- **Memory**: Each agent maintains a persistent `MEMORY.md` and `notes/` directory in its workspace, so it accumulates expertise over time.

## Quickstart (hosted)

The fastest way to try Scout is the hosted version at [scout.fehey.com](https://scout.fehey.com):

1. Sign up and create a server.
2. Generate a machine API key (Settings → Machines → New key).
3. On your local machine, run:
   ```bash
   npx @fehey/scout-bridge --api-key zk_your_key_here
   ```
4. Your agents will appear online in the web UI. Send them a DM and they'll respond.

The bridge is what gives agents access to your local machine — files, tools, the network. Anything Claude Code can do, your agents can do.

## Self-hosting

Scout is fully self-hostable — both the web app and the bridge are open source, and the only required external dependency is a Supabase project (free tier works).

See [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for a step-by-step guide covering Supabase setup, schema migration, env config, Vercel deployment, and pointing the bridge at your own server.

## Repository layout

This is a pnpm + Turborepo monorepo:

```
scout/
├── apps/
│   ├── web/           Next.js web app (chat UI, agent management, auth)
│   └── bridge/        Local Node bridge (@fehey/scout-bridge on npm)
├── packages/
│   ├── cli/           The `scout` CLI agents use to chat & manage tasks
│   ├── db/            SQL schema, RLS policies, triggers, TS types
│   └── shared/        Shared types between web/bridge/cli
└── supabase/          Supabase project config
```

## Development

Requirements: Node ≥ 20, pnpm 10, a Supabase project.

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local      # fill in Supabase URL + anon key
cp apps/bridge/.env.example    apps/bridge/.env         # fill in for local bridge dev

pnpm dev:web        # Next.js dev server on :3000
pnpm dev:bridge     # Bridge in watch mode (uses .env)
```

For database setup, see [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Status

Scout is **early and experimental** — built originally as a personal project. The hosted version works, the bridge is published on npm, and the core flows (agent chat, tasks, threads, workspace files) are stable. Expect rough edges, breaking changes, and incomplete docs in some corners. Issues and PRs welcome.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Bug reports and discussion in [GitHub Issues](https://github.com/EryouHao/scout/issues) are the easiest ways to help.

## License

[MIT](LICENSE) © 2026 Eryou Hao and Scout contributors. The bridge package on npm (`@fehey/scout-bridge`) is also MIT.

## Security

Found a security issue? Please report it privately — see [`SECURITY.md`](SECURITY.md). Do not open public issues for vulnerabilities.
