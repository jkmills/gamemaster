"use client";
import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";

function randomId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

type RoomState = {
  code: string;
  gameId?: string;
  status: "lobby" | "active" | "finished";
  discardTop: string | null;
  playerCounts: { id: string; name: string; count: number }[];
  turn: string | null;
  winner?: string | null;
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
    if (card === 'W') {
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
          <div className="text-sm">Discard Top: <span className="font-mono">{room?.discardTop ?? "—"}</span></div>
          <div className="text-sm">My Turn: {myTurn ? "Yes" : "No"}</div>

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
              <div>
                <h3 className="font-medium mb-1">My Hand</h3>
                <div className="flex flex-wrap gap-2">
                  {hand.map((c, idx) => (
                    <button
                      key={`${c}-${idx}`}
                      onClick={() => myTurn && play(idx)}
                      className={`px-3 py-2 rounded border ${myTurn ? "hover:bg-blue-50 dark:hover:bg-blue-900/30" : "opacity-60 cursor-not-allowed"}`}
                      disabled={!myTurn}
                      title={myTurn ? "Play" : "Wait for your turn"}
                    >
                      {c}
                    </button>
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
