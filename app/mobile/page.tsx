"use client";
import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";

function randomId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

type RoomState = {
  code: string;
  status: "lobby" | "active";
  discardTop: string | null;
  playerCounts: { id: string; name: string; count: number }[];
  turn: string | null;
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
    const s = io("/game", { path: "/socket.io" });
    setSocket(s);
    s.on("roomState", (state: RoomState) => setRoom(state));
    s.on("playerHand", (p: { hand: string[] }) => setHand(p.hand));
    s.on("error", (e: { message?: string }) => {
      if (e && e.message) alert(e.message);
    });
    s.on("connect_error", (e) => console.error(e));
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
    socket.emit("joinRoom", { roomCode: roomCode.trim().toUpperCase(), playerId, name: name.trim() });
    setJoined(true);
  };

  const draw = () => socket?.emit("drawCard", { roomCode, playerId });
  const pass = () => socket?.emit("passTurn", { roomCode, playerId });
  const play = (idx: number) => socket?.emit("playCard", { roomCode, playerId, cardIndex: idx });

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
          <div className="text-sm">Status: {room?.status ?? "—"}</div>
          <div className="text-sm">Discard Top: <span className="font-mono">{room?.discardTop ?? "—"}</span></div>
          <div className="text-sm">My Turn: {myTurn ? "Yes" : "No"}</div>

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
            <button className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!myTurn} onClick={draw}>Draw</button>
            <button className="px-4 py-2 rounded bg-slate-600 text-white disabled:opacity-50" disabled={!myTurn} onClick={pass}>Pass</button>
          </div>
        </div>
      )}
    </main>
  );
}
