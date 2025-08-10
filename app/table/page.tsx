"use client";
import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";

type RoomState = {
  code: string;
  status: "lobby" | "active" | "finished";
  discardTop: string | null;
  playerCounts: { id: string; name: string; count: number }[];
  turn: string | null;
  winner: string | null;
};

export default function TablePage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);

  useEffect(() => {
    const s = io("/game", { path: "/socket.io" });
    setSocket(s);
    s.on("roomState", (state: RoomState) => setRoom(state));
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

  return (
    <main className="space-y-4">
      <h2 className="text-xl font-semibold">Table</h2>
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
        <button
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          disabled={!roomCode || !socket}
          onClick={() => socket?.emit("createLobby", { roomCode })}
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
            <div className="text-sm">Discard Top: <span className="font-mono">{room.discardTop ?? "—"}</span></div>
            <div className="text-sm">Turn: <span className="font-mono">{room.turn ?? "—"}</span></div>
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
