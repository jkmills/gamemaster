"use client";
import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import Image from "next/image";

function randomId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function UnoCard({ code }: { code: string }) {
  const { src, label } = useMemo(() => {
    const colorKey = code[0];
    const isWild = colorKey === 'W';
    const src = isWild
      ? '/uno/uno_wild.png'
      : colorKey === 'R'
      ? '/uno/uno_red.png'
      : colorKey === 'Y'
      ? '/uno/uno_yellow.png'
      : colorKey === 'G'
      ? '/uno/uno_green.png'
      : '/uno/uno_blue.png';
    // Determine label/symbol
    let body = code.slice(1);
    // Handle encoded discard wilds like 'WR' or 'W+4R'
    if (isWild) {
      if (code.startsWith('W+4')) body = '+4';
      else body = 'W';
    } else if (body === 'RV') body = 'Rev';
    else if (body === 'S') body = 'Skip';
    const label = body || '';
    return { src, label };
  }, [code]);
  return (
    <div className="relative w-14 h-20 rounded shadow border overflow-hidden">
      <Image src={src} alt={code} fill style={{ objectFit: 'cover' }} />
      <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
        {label}
      </div>
    </div>
  );
}

type RoomState = {
  code: string;
  gameId?: string;
  status: "lobby" | "active" | "finished";
  discardTop: string | null;
  playerCounts: { id: string; name: string; count: number }[];
  turn: string | null;
  winner?: string | null;
  log?: string[];
  flip7?: {
    scores: { id: string; name: string; score: number }[];
    roundScore: { id: string; name: string; score: number }[];
    stayed: string[];
    busted: string[];
    uniquesCount: { id: string; name: string; count: number }[];
    roundOver: boolean;
  };
};

export default function MobilePage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [playerId, setPlayerId] = useState<string>(() => randomId());
  const [joined, setJoined] = useState(false);
  const [hand, setHand] = useState<string[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);

  useEffect(() => {
    // hydrate from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem("gm.session") || "null");
      if (saved && saved.playerId && saved.roomCode) {
        setPlayerId(saved.playerId);
        setRoomCode(saved.roomCode);
        if (saved.name) setName(saved.name);
        if (saved.joined) setJoined(true);
      }
    } catch {}

    const s = io("/game", { path: "/socket.io" });
    setSocket(s);
    s.on("roomState", (state: RoomState) => setRoom(state));
    s.on("playerHand", (p: { hand: string[] }) => setHand(p.hand));
    s.on("notice", (n: { message?: string }) => {
      if (n?.message) alert(n.message);
    });
    s.on("error", (e: { message?: string }) => {
      if (e && e.message) alert(e.message);
    });
    s.on("connect", () => {
      // auto rejoin and fetch hand if we have a session
      if (joined && roomCode && playerId && name) {
        s.emit("joinRoom", { roomCode, playerId, name });
        s.emit("getHand", { roomCode, playerId });
      }
    });
    s.on("connect_error", (e) => console.error(e));
    s.on("roomClosed", ({ roomCode: rc }: { roomCode: string }) => {
      alert(`Room ${rc} was closed.`);
      setJoined(false);
      setRoom(null);
      setHand([]);
      try { localStorage.removeItem('gm.session'); } catch {}
    });
    return () => {
      s.disconnect();
    };
  }, []);

  const myTurn = useMemo(() => {
    if (!room) return false;
    return room.turn === playerId;
  }, [room, playerId]);

  const join = () => {
    if (!socket || !roomCode || !name) return;
    const normalized = roomCode.trim().toUpperCase();
    const trimmedName = name.trim();
    setRoomCode(normalized); // ensure subsequent emits match server room key
    socket.emit("joinRoom", { roomCode: normalized, playerId, name: trimmedName });
    setJoined(true);
    // persist session
    try {
      localStorage.setItem(
        "gm.session",
        JSON.stringify({ roomCode: normalized, playerId, name: trimmedName, joined: true })
      );
    } catch {}
  };

  const draw = () => socket?.emit("drawCard", { roomCode, playerId });
  const pass = () => socket?.emit("passTurn", { roomCode, playerId });
  const flip7Hit = () => socket?.emit("flip7:hit", { roomCode, playerId });
  const flip7Stay = () => socket?.emit("flip7:stay", { roomCode, playerId });
  const play = (idx: number) => {
    if (!socket) return;
    const card = hand[idx];
    let chosenColor: string | undefined = undefined;
    if (card === 'W' || card === 'W+4') {
      const picked = prompt('Choose color: R, G, B, or Y', 'R');
      const c = (picked || '').trim().toUpperCase()[0];
      if (c && ['R','G','B','Y'].includes(c)) {
        chosenColor = c;
      } else {
        alert('Invalid color. Play canceled.');
        return;
      }
    }
    socket.emit("playCard", { roomCode, playerId, cardIndex: idx, chosenColor });
  };

  const leave = () => {
    if (socket && roomCode) {
      socket.emit("leaveRoom", { roomCode, playerId });
    }
    setJoined(false);
    setRoom(null);
    setHand([]);
    try { localStorage.removeItem("gm.session"); } catch {}
  };

  const changeRoom = () => {
    // Reset client state to allow joining a different room; keep name and playerId
    setJoined(false);
    setRoom(null);
    setHand([]);
    try { localStorage.removeItem("gm.session"); } catch {}
  };

  return (
    <main className="space-y-4">
      <h2 className="text-xl font-semibold">Mobile</h2>
      {myTurn && (
        <div className="rounded bg-emerald-600 text-white px-3 py-2 text-sm font-semibold shadow">
          Your turn — play a card or draw
        </div>
      )}

      {!joined ? (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">Your ID: <span className="font-mono">{playerId}</span></div>
          <label className="block">
            <span className="text-sm">Room Code</span>
            <input
              className="block mt-1 w-full border rounded px-3 py-2 bg-white/80 dark:bg-black/20"
              placeholder="e.g. ABC123"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block">
            <span className="text-sm">Display Name</span>
            <input
              className="block mt-1 w-full border rounded px-3 py-2 bg-white/80 dark:bg-black/20"
              placeholder="e.g. Alice"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
            disabled={!socket || !roomCode || !name}
            onClick={join}
          >
            Join Room
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm">Room: <span className="font-mono">{room?.code ?? roomCode}</span></div>
          <div className="text-sm">Game: {room?.gameId ?? "—"}</div>
          <div className="text-sm">Status: {room?.status ?? "—"}</div>
          <div className="text-sm flex items-center gap-2">Discard Top: <span className="font-mono">{room?.discardTop ?? "—"}</span>
            {room?.discardTop && (
              <div className="ml-2 flex flex-col items-center" aria-label={`Discard ${room.discardTop}`}>
                <UnoCard code={room.discardTop} />
                <div className="mt-1 text-[10px] leading-none font-mono text-gray-700 dark:text-gray-300" aria-hidden>
                  {room.discardTop}
                </div>
              </div>
            )}
          </div>
          <div className="text-sm">My Turn: {myTurn ? "Yes" : "No"}</div>
          {room?.log && room.log.length > 0 && (
            <div className="mt-2">
              <h3 className="font-medium mb-1">Log</h3>
              <ul className="text-xs space-y-1 max-h-40 overflow-auto border rounded p-2 bg-black/5 dark:bg-white/5">
                {room.log.map((entry, i) => (
                  <li key={i} className="font-mono">{entry}</li>
                ))}
              </ul>
            </div>
          )}

          {room?.gameId === 'flip7' ? (
            <>
              <div>
                <h3 className="font-medium mb-1">Round</h3>
                <div className="text-xs">Stayed: {room.flip7?.stayed.join(', ') || '—'}</div>
                <div className="text-xs">Busted: {room.flip7?.busted.join(', ') || '—'}</div>
                <div className="mt-1 text-xs">Uniques: {room.flip7?.uniquesCount.map(u => `${u.name}:${u.count}`).join(' | ') || '—'}</div>
                <div className="mt-1 text-xs">Round Scores: {room.flip7?.roundScore.map(s => `${s.name}:${s.score}`).join(' | ') || '—'}</div>
                <div className="mt-1 text-xs">Total Scores: {room.flip7?.scores.map(s => `${s.name}:${s.score}`).join(' | ') || '—'}</div>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                  disabled={!socket || !roomCode || !myTurn}
                  onClick={() => {
                    if (!myTurn) { alert('Not your turn'); return; }
                    flip7Hit();
                  }}
                >
                  Hit
                </button>
                <button
                  className="px-4 py-2 rounded bg-slate-600 text-white disabled:opacity-50"
                  disabled={!myTurn}
                  onClick={() => flip7Stay()}
                >
                  Stay
                </button>
                <button className="px-4 py-2 rounded bg-amber-600 text-white" onClick={changeRoom}>Change Room</button>
                <button className="px-4 py-2 rounded bg-red-600 text-white" onClick={leave}>Leave Room</button>
              </div>
            </>
          ) : (
            <>
              <div className={myTurn ? "p-2 rounded ring-2 ring-emerald-500/70 shadow animate-pulse" : ""}>
                <h3 className="font-medium mb-1">My Hand</h3>
                <div className="flex flex-wrap gap-3">
                  {hand.map((c, idx) => (
                    <div key={`${c}-${idx}`} className="flex flex-col items-center">
                      <button
                        onClick={() => myTurn && play(idx)}
                        className={`rounded ${myTurn ? "" : "opacity-60 cursor-not-allowed"}`}
                        disabled={!myTurn}
                        title={myTurn ? "Play" : "Wait for your turn"}
                        aria-label={`Card ${c}`}
                      >
                        <UnoCard code={c} />
                      </button>
                      <div className="mt-1 text-[10px] leading-none font-mono text-gray-700 dark:text-gray-300" aria-hidden>
                        {c}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                  disabled={!socket || !roomCode}
                  onClick={() => {
                    if (!myTurn) {
                      alert("Not your turn");
                    }
                    draw();
                  }}
                >
                  Draw
                </button>
                <button className="px-4 py-2 rounded bg-slate-600 text-white disabled:opacity-50" disabled={!myTurn} onClick={pass}>Pass</button>
                <button className="px-4 py-2 rounded bg-amber-600 text-white" onClick={changeRoom}>Change Room</button>
                <button className="px-4 py-2 rounded bg-red-600 text-white" onClick={leave}>Leave Room</button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
