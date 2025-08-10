# gamemaster

## Overview
Single Next.js 14 app with an embedded Socket.IO server. In-memory state (no DB) for the MVP.

- Table: create/watch lobby, start game, view state
- Mobile: join via code+name, draw/play/pass

## Prerequisites
- Node.js 18+
- npm or pnpm

## Local Development
```bash
# install deps
npm install

# start dev server (Next + Socket.IO)
npm run dev
# open http://localhost:3000
```

Useful routes:
- /table
- /mobile

## Production (local)
```bash
npm run build
npm start
```

## Deploy (Render Blueprint)
This repo includes `render.yaml` for a Render web service.

Steps:
1) Push the repo to GitHub.
2) In Render: New → Blueprint → choose this repo.
3) Render creates web service “gamemaster-mvp”.
4) First deploy runs:
   - Build: `npm ci && npm run build`
   - Start: `npm start` (runs `node server.js`)
5) After deploy:
   - https://<your-service>.onrender.com/table
   - https://<your-service>.onrender.com/mobile

Notes:
- WebSockets are supported on Render by default.
- `PORT` is provided by Render; `server.js` binds to it.
- `SESSION_COOKIE_SECRET` is generated via `render.yaml` envVars.

## Troubleshooting
- If the server doesn’t start on Render, check build logs.
- Ensure Node 18+ locally. To pin Node:
  ```json
  {
    "engines": { "node": ">=18" }
  }
  ```

## License
MIT