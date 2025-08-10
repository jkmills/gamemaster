# PLAN.md

## Project: Real-time Card & Dice Tabletop Platform (Phase 0 MVP)

**Goal:** Deliver a browser-based platform for local multiplayer card/dice games with:
- Admin console to create a lobby and tweak a simple Uno-like game template
- Game Console display for shared table state (deck, discard, player counts, turn)
- Mobile player client for private hands and actions
- Real-time updates with a single authoritative server

**Phase 0 Scope:** One room, up to 4 players, Uno-like rules, happy-path only, simple auth, reconnect, minimal persistence.

---

## 1) Definition of Done (Phase 0)

- Players join via 6-character room code, set a display name, and enter the lobby.
- Host starts game from Admin; Game Console shows deck, discard top, per-player card count, active turn.
- Mobile clients render private hands; players can draw, play legal cards, pass.
- Near real-time sync; reconnect within 10 seconds retains seat.
- Admin can tweak basic template settings via JSON (colors, labels, hand size).
- Deployments reproducible; CI runs lint, unit tests, basic E2E.
- Logging exists for core actions. A single environment can be bootstrapped from scratch with documented commands.

---

## 2) Architecture Overview

**Monorepo (pnpm + Turborepo)**

apps/
admin-web/ # Next.js (Admin)
game-console-web/ # Next.js (Table Display)
mobile-web/ # Next.js PWA (Player)
game-server/ # Node (NestJS or Fastify) + Socket.IO
packages/
shared/ # TypeScript types, zod schemas, rules functions

kotlin
Copy
Edit

**Tech choices**
- TypeScript everywhere
- Next.js + React + Tailwind for UIs
- NestJS (or Fastify) + Socket.IO on the server
- Postgres (Prisma) for persistence
- In-memory state for the active match; DB snapshot in `GameInstance.stateJson`
- Deterministic RNG using `seedrandom` on server only
- Optional Redis deferred to Phase 1

**Hosting (MVP)**
- Frontends: Vercel
- Server: Railway or Render
- DB: Neon (Postgres)
- No Redis in Phase 0

---

## 3) Data Model (Phase 0)

    Prisma schema outline:

    ```prisma
    model GameDefinition {
    id           String   @id @default(cuid())
    name         String
    version      Int      @default(1)
    settingsJson Json
    createdAt    DateTime @default(now())
    }

    model GameInstance {
    id            String   @id @default(cuid())
    code          String   @unique
    definitionId  String
    definition    GameDefinition @relation(fields: [definitionId], references: [id])
    seed          String
    status        String
    stateJson     Json
    createdAt     DateTime @default(now())
    updatedAt     DateTime @updatedAt
    players       Player[]
    }

    model Player {
    id          String   @id @default(cuid())
    instanceId  String
    instance    GameInstance @relation(fields: [instanceId], references: [id])
    displayName String
    seat        Int
    connected   Boolean  @default(true)
    createdAt   DateTime @default(now())

    @@index([instanceId])
    }

4) Real-time Contract (Socket.IO)
    Namespace: /game
    Rooms: instance:<instanceId>

    Client → Server events
    joinRoom
    startGame
    drawCard
    playCard
    passTurn
    Server → Client events
    roomState
    error
    presence (optional Phase 0)

5) Game Logic (Uno-like, Phase 0)
    Starting hand size default 7.
    Turn order forward only in Phase 0.
    Play is legal if color matches OR number/symbol matches OR Wild.
    Draw 1 then may play if legal; otherwise Pass.
    Wild requires color selection.
    No stacking or challenge in Phase 0.

6) UX Flows
    Admin
    Auth: single password
    Pages: JSON editor + Create Lobby
    Game Console
    Lobby: show code and QR, player list, Start button
    Active: deck back, discard, player counts, turn indicator
    Mobile
    Join with code and name
    Show hand, draw/play/pass buttons, wild color picker
    Turn indicator and latency dot

7) Security (Phase 0)
    Admin protected by a single env password.
    Player identity: signed cookie for instanceId/playerId.
    Name sanitized.
    CORS restricted to front-end deploy origins.
    HTTPS at edge.

8) Testing Strategy
    Unit
    Deck determinism
    Legal moves correctness
    Action application
    Contract
    zod parse for all socket payloads
    E2E
    Admin creates lobby, two players join, start game, play turns, verify state

9) CI/CD
    GitHub Actions
    Install
    Lint + TS check
    Unit + E2E tests
    Build all apps
    Deploy (Vercel, Railway)
    DB migrate before server rollout

10) Env & Config
.env.example:

    ini
    Copy
    Edit
    DATABASE_URL=postgres://...
    PUBLIC_BASE_URL=https://...
    ADMIN_PASSWORD=...
    PORT=8080
    NODE_ENV=production
    SESSION_COOKIE_SECRET=...
    CORS_ORIGINS=https://admin...,https://console...,https://mobile...
    11) Developer Setup
    Node 20+, pnpm, Docker (optional)

    Local Postgres via Docker

12) Work Breakdown (Phase 0, 7 days)
    Day 1
    Repo + schema + server/socket boot
    Day 2
    Room lifecycle, join flow, session cookie
    Day 3
    Rules functions, start game
    Day 4
    Table and Mobile UI basics
    Day 5
    Reconnect, errors, admin editor
    Day 6
    Tests + deployment
    Day 7
    Playtest + fixes

13) Tickets
MR-001 Monorepo scaffolding



14) Acceptance Tests
    Join & Lobby works
    Start & Deal correct
    Legal Play updates state
    Draw & Pass correct
    Wild card flow works
    Reconnect within grace period works
    Stale actions rejected

15) API Sketches
    POST /api/lobbies → create lobby
    GET /api/definitions/:id → get template

PUT /api/definitions/:id → update template

GET /healthz → health

16) Game Template Settings Example
json
Copy
Edit
{
  "startingHandSize": 7,
  "colors": ["R", "G", "B", "Y"],
  "labels": {
    "R": "Red",
    "G": "Green",
    "B": "Blue",
    "Y": "Yellow"
  },
  "deckSpec": {
    "numberCards": { "0": 1, "1": 2, "2": 2, "3": 2, "4": 2, "5": 2, "6": 2, "7": 2, "8": 2, "9": 2 },
    "actionCards": { "Skip": 2, "Reverse": 2, "Draw2": 2 },
    "wildCards": { "Wild": 4 }
  },
  "ui": {
    "cardRadius": 12,
    "handMaxVisible": 8
  }
}
17) Prompts for Assistant Planning (Windsurf/ChatGPT)
Rules Engine Review

Socket Contract

UI Stubs

E2E Tests

Deploy Workflow

18) Risks & Constraints (Phase 0)
Single server instance only

No Redis or scaling

Player identity by cookie+name

iOS background socket issues possible

19) Roadmap Preview (Phase 1)
Event sourcing + Redis

XState for turn flow

Expanded rules DSL

JWT per player

More templates

20) Appendix: Commands
Local DB

bash
Copy
Edit
docker run --rm -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
Prisma

bash
Copy
Edit
pnpm dlx prisma generate
pnpm dlx prisma migrate dev
pnpm dlx prisma studio
Dev

bash
Copy
Edit
pnpm -w dev
Build

bash
Copy
Edit
pnpm -w build
Test

bash
Copy
Edit
pnpm -w test
pnpm --filter e2e test