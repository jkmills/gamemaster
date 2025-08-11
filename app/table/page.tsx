"use client";
import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import Image from "next/image";

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
    let body = code.slice(1);
    if (isWild) {
      if (code.startsWith('W+4')) body = '+4'; else body = 'W';
    } else if (body === 'RV') body = 'Rev';
    else if (body === 'S') body = 'Skip';
    const label = body || '';
    return { src, label };
  }, [code]);
  return (
    <div className="relative w-16 h-24 rounded shadow border overflow-hidden">
      <Image src={src} alt={code} fill style={{ objectFit: 'cover' }} />
      <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
        {label}
      </div>
    </div>
  );
}

type RoomState = {
  code: string;
  status: "lobby" | "active" | "finished";
  discardTop: string | null;
  playerCounts: { id: string; name: string; count: number }[];
  turn: string | null;
  winner: string | null;
};

type GameInfo = { id: string; name: string };

export default function TablePage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [gameId, setGameId] = useState<string>("uno");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [played, setPlayed] = useState<{name:string, card:string} | null>(null);

  useEffect(() => {
    const s = io("/game", { path: "/socket.io" });
    setSocket(s);
    s.on("roomState", (state: RoomState) => setRoom(state));
    s.on("cardPlayed", ({ name, card }: { name: string; card: string }) => {
      if (!card) return;
      setPlayed({ name, card });
      // shrink-away after a moment
      setTimeout(() => setPlayed(null), 1200);
    });
    s.on("error", (e: { message?: string }) => {
      if (e && e.message) alert(e.message);
    });
    s.on("roomClosed", ({ roomCode }: { roomCode: string }) => {
      alert(`Room ${roomCode} was closed.`);
      setRoom(null);
    });
    s.on("connect_error", (e) => console.error(e));
    return () => {
      s.disconnect();
    };
  }, []);

  const canStart = room && room.status === "lobby" && (room.playerCounts?.length || 0) >= 2;
  const currentPlayerName = useMemo(() => {
    if (!room?.turn) return null;
    const p = room.playerCounts?.find(p => p.id === room.turn);
    return p?.name || room.turn;
  }, [room]);
  const winnerName = useMemo(() => {
    if (!room?.winner) return null;
    const p = room.playerCounts?.find(p => p.id === room.winner);
    return p?.name || room.winner;
  }, [room]);
  const joinUrl = useMemo(() => {
    if (!room?.code) return '';
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    return `${origin}/mobile?code=${encodeURIComponent(room.code)}`;
  }, [room]);

  return (
    <main className="space-y-4">
      <h2 className="text-xl font-semibold">Table</h2>
      {room?.turn && (
        <div className="rounded bg-emerald-600 text-white px-3 py-2 text-sm font-semibold shadow">
          Turn: {currentPlayerName ?? room.turn}
        </div>
      )}
      {room?.winner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="text-center text-white">
            <div className="text-2xl font-semibold">Winner</div>
            <div className="mt-2 text-6xl font-extrabold">{winnerName}</div>
            <div className="mt-6 flex gap-3 justify-center">
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white"
                onClick={() => room && socket?.emit('restartGame', { roomCode: room.code })}
              >Play Again</button>
              <button
                className="px-4 py-2 rounded bg-red-600 text-white"
                onClick={() => room && socket?.emit('closeRoom', { roomCode: room.code })}
              >Close Room</button>
            </div>
          </div>
        </div>
      )}
      {played && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center">
          <div className="animate-[fadeShrink_1.2s_ease_forwards] text-center">
            <div className="mb-2 text-white text-xl drop-shadow">{played.name} played</div>
            <div className="inline-block transform origin-center">
              <UnoCard code={played.card} />
            </div>
          </div>
          <style jsx>{`
            @keyframes fadeShrink {
              0% { transform: scale(1); opacity: 1; }
              70% { transform: scale(0.5); opacity: 0.9; }
              100% { transform: scale(0.2); opacity: 0; }
            }
          `}</style>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <label className="block">
          <span className="text-sm">Room Code</span>
          <input
            className="block mt-1 border rounded px-3 py-2 bg-white/80 dark:bg-black/20"
            placeholder="e.g. ABC123"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.trim().toUpperCase())}
          />
        </label>
        <label className="block">
          <span className="text-sm">Game</span>
          <select
            className="block mt-1 border rounded px-3 py-2 bg-white/80 dark:bg-black/20"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
          >
            <option value="uno">Uno (MVP)</option>
            {/* Flip7 temporarily disabled */}
          </select>
        </label>
        <button
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          disabled={!roomCode || !socket}
          onClick={() => socket?.emit("createLobby", { roomCode, gameId })}
        >
          Create Lobby
        </button>
        <button
          className="px-4 py-2 rounded bg-slate-600 text-white disabled:opacity-50"
          disabled={!roomCode || !socket}
          onClick={() => socket?.emit("watchRoom", { roomCode })}
        >
          Watch Lobby
        </button>
        <button
          className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
          disabled={!socket || !roomCode || !canStart}
          onClick={() => socket?.emit("startGame", { roomCode })}
        >
          Start Game
        </button>
        <button
          className="px-4 py-2 rounded bg-red-600 text-white disabled:opacity-50"
          disabled={!socket || !roomCode}
          onClick={() => {
            if (confirm("Reset this room? All hands and state will be cleared.")) {
              socket?.emit("resetRoom", { roomCode });
            }
          }}
        >
          Reset Room
        </button>
        <button
          className="px-4 py-2 rounded bg-red-800 text-white disabled:opacity-50"
          disabled={!socket || !roomCode}
          onClick={() => {
            if (confirm("Close this room? Everyone will be disconnected and the room code will be invalid.")) {
              socket?.emit("closeRoom", { roomCode });
            }
          }}
        >
          Close Room
        </button>
      </div>

      <section className="mt-4 border rounded p-4">
        <h3 className="font-medium mb-2">Room</h3>
        {!room ? (
          <p className="text-sm text-gray-600">No room selected.</p>
        ) : (
          <div className="space-y-2">
            <div className="text-sm">Code: <span className="font-mono">{room.code}</span></div>
            <div className="text-sm">Status: {room.status}</div>
            {room.status === 'lobby' && (
              <div className="mt-2 p-4 rounded border bg-white/60 dark:bg-black/20 flex flex-col sm:flex-row items-center gap-4">
                <div className="text-4xl sm:text-5xl font-extrabold tracking-widest font-mono">{room.code}</div>
                {joinUrl && (
                  <div className="flex flex-col items-center">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`}
                      alt={`Join ${room.code}`}
                      className="w-40 h-40 border rounded bg-white"
                    />
                    <div className="mt-2 text-xs text-center break-all max-w-xs">
                      {joinUrl}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="text-sm flex items-center gap-2">Discard Top: <span className="font-mono">{room.discardTop ?? "—"}</span>
              {room.discardTop && (
                <div className="ml-2 flex flex-col items-center" aria-label={`Discard ${room.discardTop}`}>
                  <UnoCard code={room.discardTop} />
                  <div className="mt-1 text-[10px] leading-none font-mono text-gray-700 dark:text-gray-300" aria-hidden>
                    {room.discardTop}
                  </div>
                </div>
              )}
            </div>
            <div className="text-sm">Turn: <span className="font-mono">{room.turn ?? "—"}</span>{currentPlayerName ? ` – ${currentPlayerName}` : ''}</div>
            {room.status === 'finished' && (
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                Winner: {(() => {
                  const w = room.winner;
                  if (!w) return '—';
                  const p = room.playerCounts.find(p => p.id === w);
                  return p ? `${p.name} (${w})` : w;
                })()}
              </div>
            )}
            <div>
              <h4 className="font-medium">Players</h4>
              <ul className="list-disc ml-6 text-sm">
                {room.playerCounts.map((p) => (
                  <li key={p.id}>
                    {p.name} (<span className="font-mono">{p.id}</span>): {p.count}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
