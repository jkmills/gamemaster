# PLAN.md

## Project: Real-time Card & Dice Tabletop Platform (Phase 0 MVP)

**Goal:** Deliver a browser-based platform for local multiplayer card/dice games with:
- Admin console to create a lobby and tweak a simple Uno-like game template
- Game Console display for shared table state (deck, discard, player counts, turn)
- Mobile player client for private hands and actions
- Real-time updates with a single authoritative server

**Phase 0 Scope:** One room, up to 4 players, Uno-like rules, happy-path only, simple auth, reconnect, minimal persistence.

---

## Phase 0-Lite Plan (MVP)

This section supersedes sections 2, 3, 6, 7, 8, 9, 10, 12, and 20 for the MVP only. The original content remains as Phase 1+ reference.

- Single app: Next.js 14 (App Router) with UI, API routes, and Socket.IO in one deploy. No monorepo or separate apps.
- No DB in Phase 0: in-memory room/match store on the server. Optional JSON snapshot to disk in local dev.
- Hardcode Uno-like template in code; defer Admin JSON editor and settings UI.
- Two surfaces only: Table (create lobby, lobby, start, table state) and Mobile (join and play). Fold Admin actions into Table.
- Minimal auth: non-guessable room code (8–10 chars base32) + signed cookie for player identity. No admin password.
- Socket.IO contract kept minimal: joinRoom, startGame, drawCard, playCard, passTurn, roomState, error. Drop presence and strong reconnect guarantees for MVP.
- Rules: color/number match + Wild only. No Skip/Reverse/Draw2 in Phase 0. Deterministic deck via seedrandom server-side.
- Testing: unit tests for rules (deck determinism, legal move, apply action). Manual smoke script for end-to-end.
- CI/CD: single job (install, lint, typecheck, unit tests, build, deploy single app). No E2E in CI. One host (Railway/Render or Vercel with custom server).
- Timeline: 3 days total. Day 1 scaffold + sockets + room store. Day 2 rules + UIs. Day 3 tests + smoke + deploy.

---

## 1) Definition of Done (Phase 0)

 - 2–4 players join via room code, set a display name, and enter the lobby.
 - Table view can create a lobby and start the game; it shows deck back, discard top, per-player card count, and active turn.
 - Mobile clients render private hands; players can draw, play legal cards, pass.
 - Near real-time sync; players may rejoin via code+name if disconnected.
 - CI runs lint, typecheck, and unit tests; single deploy pipeline.
 - Logging exists for core actions. A single environment can be bootstrapped from scratch with documented commands.

---

## 2) Architecture Overview

**Single App (Next.js 14 + Socket.IO)**

- One Next.js app (App Router) serves Table and Mobile routes and hosts a Socket.IO server.
- In-memory room/match store keyed by room code (no DB in Phase 0).
- Shared types and rules in `/lib` within the app.
- Deterministic RNG via `seedrandom` on the server.

**Hosting (MVP)**
- Deploy a single app to one host (Railway/Render or Vercel with custom server).
- No Redis or separate DB in Phase 0.

---

## 4) Real-time Contract (Socket.IO)
    Namespace: /game
    Rooms: instance:<roomCode>

    Client → Server events
    joinRoom
    startGame
    drawCard
    playCard
    passTurn
    Server → Client events
    roomState
    error

## 5) Game Logic (Uno-like, Phase 0)
    Starting hand size default 7.
    Turn order forward only in Phase 0.
    Play is legal if color matches OR number/symbol matches OR Wild.
    Draw 1 then may play if legal; otherwise Pass.
    Wild requires color selection.
    No stacking or challenge in Phase 0.

## 6) UX Flows
    Table
    Create Lobby (generates room code and seed)
    Lobby: show code/QR, player list, Start button
    Active: deck back, discard, player counts, turn indicator
    Mobile
    Join with code and name
    Show hand, draw/play/pass buttons, wild color picker
    Turn indicator

## 7) Security (Phase 0)
    Player identity: signed cookie for roomCode/playerId.
    Name sanitized.
    Single app avoids cross-origin; HTTPS via host.

## 8) Testing Strategy
    Unit
    Deck determinism
    Legal moves correctness
    Action application
    Local multi-user simulation
        - Open multiple browser windows/tabs with different profiles or incognito to isolate cookies.
        - Use separate devices (phone + laptop) to test Table + Mobile surfaces simultaneously.
        - If using a PWA/mobile view, enable device emulation in browser devtools for quick iteration.

## 9) CI/CD
    GitHub Actions
    Install
    Lint + typecheck
    Unit tests
    Build single app
    Deploy single app

## 10) Env & Config
.env.example:

    PORT=8080
    NODE_ENV=production
    SESSION_COOKIE_SECRET=...
    PUBLIC_BASE_URL=https://...

## 11) Developer Setup
    Node 20+, pnpm

## 12) Work Breakdown (Phase 0, 3 days)
    Day 1
    Next.js scaffold, Socket.IO server, in-memory store, room code generation
    Day 2
    Rules + deck + actions; Table and Mobile UI basics
    Day 3
    Unit tests, manual smoke script, minimal CI, deploy

## 13) Tickets
MR-001 Single-app scaffold (Next.js + Socket.IO)

## 14) Acceptance Tests
    Join & Lobby works
    Start & Deal correct
    Two players can alternate turns; rotation works with 3–4 players.
    Legal Play updates state
    Draw & Pass correct
    Wild card flow works

## 15) API Sketches
    Socket.IO only for game actions (see Contract)
    GET /healthz → health

## 18) Risks & Constraints (Phase 0)
Single server instance only

No Redis or scaling

Player identity by cookie+name

iOS background socket issues possible

## 20) Appendix: Commands
Dev

    pnpm dev
Build

    pnpm build
Test

    pnpm test