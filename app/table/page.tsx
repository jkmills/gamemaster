"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import Image from "next/image";
import { useNotifications } from "../../components/Notifications";
import { formatCard, colorName } from "../../games/unoUtils";

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
    <div className="relative w-32 h-48 rounded shadow border overflow-hidden">
      <Image src={src} alt={code} fill style={{ objectFit: 'cover' }} />
      <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
        {label}
      </div>
    </div>
  );
}

function readableCard(code: string) {
  let name = formatCard(code);
  if (code.startsWith('W')) {
    const col = code.replace('W', '').replace('+4', '')[0];
    if (col) name += ` (${colorName(col)})`;
  }
  return name;
}

type RoomState = {
  code: string;
  status: "lobby" | "active" | "finished";
  discardTop: string | null;
  playerCounts: { id: string; name: string; avatar?: string | null; count: number }[];
  turn: string | null;
  winner: string | null;
};

type GameInfo = { id: string; name: string };

export default function TablePage() {
  const { notify, confirm } = useNotifications();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [gameId, setGameId] = useState<string>("uno");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [played, setPlayed] = useState<{playerId:string, name:string, card:string} | null>(null);
  const [playedStyle, setPlayedStyle] = useState<React.CSSProperties | undefined>(undefined);
  const discardRef = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef<HTMLDivElement | null>(null);
  const playerAnchorsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    const s = io("/game", { path: "/socket.io" });
    setSocket(s);
    s.on("roomState", (state: RoomState) => setRoom(state));
    s.on("cardPlayed", ({ playerId, name, card }: { playerId: string; name: string; card: string }) => {
      if (!card) return;
      notify("draw", `${name.slice(0,16)} played a ${readableCard(card)}`);
      setPlayed({ playerId, name: name.slice(0,16), card });
      // multi-stage: from player anchor -> center (80vh) -> discard
      setPlayedStyle({ opacity: 0 });
      setTimeout(() => {
        const ov = playedRef.current?.getBoundingClientRect();
        const srcAnchor = playerAnchorsRef.current.get(playerId)?.getBoundingClientRect();
        if (!ov || !srcAnchor) {
          // fallback directly to discard
          const dst = discardRef.current?.getBoundingClientRect();
          if (!ov || !dst) {
            setPlayedStyle({ opacity: 0, transition: 'opacity 900ms ease-in-out' });
            setTimeout(() => { setPlayed(null); setPlayedStyle(undefined); }, 950);
            return;
          }
          const ovCx = ov.left + ov.width / 2;
          const ovCy = ov.top + ov.height / 2;
          const dstCx = dst.left + dst.width / 2;
          const dstCy = dst.top + dst.height / 2;
          const tx = dstCx - ovCx;
          const ty = dstCy - ovCy;
          const scale = dst.width / ov.width;
          setPlayedStyle({ transform: 'translate(0px, 0px) scale(1)', opacity: 1 });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setPlayedStyle({
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                opacity: 0,
                transition: 'transform 900ms ease-in-out, opacity 900ms ease-in-out',
                willChange: 'transform, opacity',
              });
              setTimeout(() => { setPlayed(null); setPlayedStyle(undefined); }, 950);
            });
          });
          return;
        }
        const ovCx = ov.left + ov.width / 2;
        const ovCy = ov.top + ov.height / 2;
        const srcCx = srcAnchor.left + srcAnchor.width / 2;
        const srcCy = srcAnchor.top + srcAnchor.height / 2;
        const fromTx = srcCx - ovCx;
        const fromTy = srcCy - ovCy;
        // stage 1: from player anchor to center at full size
        setPlayedStyle({ transform: `translate(${fromTx}px, ${fromTy}px) scale(0.2)`, opacity: 0 });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setPlayedStyle({ transform: 'translate(0px, 0px) scale(1)', opacity: 1, transition: 'transform 450ms ease-out, opacity 450ms ease-out' });
            // stage 2 after brief hold
            setTimeout(() => {
              const nowOv = playedRef.current?.getBoundingClientRect();
              const dst = discardRef.current?.getBoundingClientRect();
              if (!nowOv || !dst) {
                setPlayedStyle({ opacity: 0, transition: 'opacity 900ms ease-in-out' });
                setTimeout(() => { setPlayed(null); setPlayedStyle(undefined); }, 950);
                return;
              }
              const nowCx = nowOv.left + nowOv.width / 2;
              const nowCy = nowOv.top + nowOv.height / 2;
              const dstCx = dst.left + dst.width / 2;
              const dstCy = dst.top + dst.height / 2;
              const tx = dstCx - nowCx;
              const ty = dstCy - nowCy;
              const scale = dst.width / nowOv.width;
              setPlayedStyle({
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                opacity: 0,
                transition: 'transform 900ms ease-in-out, opacity 900ms ease-in-out',
                willChange: 'transform, opacity',
              });
              setTimeout(() => { setPlayed(null); setPlayedStyle(undefined); }, 950);
            }, 600);
          });
        });
      }, 50);
    });
    s.on("cardDrawn", ({ name }: { playerId: string; name: string }) => {
      notify("draw", `${name.slice(0,16)} drew a card`);
    });
    s.on("error", (e: { message?: string }) => {
      if (e?.message) notify("error", e.message);
    });
    s.on("roomClosed", ({ roomCode }: { roomCode: string }) => {
      notify("notice", `Room ${roomCode} was closed.`);
      setRoom(null);
    });
    s.on("connect_error", (e) => console.error(e));
    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (showInstructions && !instructions) {
      fetch('/UNO.md')
        .then(r => r.text())
        .then(setInstructions)
        .catch(() => setInstructions('Instructions unavailable.'));
    }
  }, [showInstructions, instructions]);

  const canStart = room && room.status === "lobby" && (room.playerCounts?.length || 0) >= 2;
  const currentPlayerName = useMemo(() => {
    if (!room?.turn) return null;
    const p = room.playerCounts?.find(p => p.id === room.turn);
    return p?.name?.slice(0,16) || room.turn;
  }, [room]);
  const winnerName = useMemo(() => {
    if (!room?.winner) return null;
    const p = room.playerCounts?.find(p => p.id === room.winner);
    return p?.name?.slice(0,16) || room.winner;
  }, [room]);
  const joinUrl = useMemo(() => {
    if (!room?.code) return '';
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    return `${origin}/mobile?code=${encodeURIComponent(room.code)}`;
  }, [room]);
  const playedVisual = useMemo(() => {
    if (!played) return null;
    const code = played.card;
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
  }, [played]);

  return (
    <main className="space-y-4">
      <h2 className="text-xl font-semibold">Table</h2>
      {/* Player anchors around edges instead of turn banner */}
      {room && room.playerCounts?.length > 0 && (
        <div className="fixed inset-0 pointer-events-none z-20">
          {room.playerCounts.map((p, i) => {
            const pos = ['top','right','bottom','left'][i % 4];
            const common = "absolute flex items-center justify-center";
            let cls = '';
            if (pos === 'top') cls = 'top-4 left-1/2 -translate-x-1/2';
            else if (pos === 'right') cls = 'right-4 top-1/2 -translate-y-1/2';
            else if (pos === 'bottom') cls = 'bottom-4 left-1/2 -translate-x-1/2';
            else cls = 'left-4 top-1/2 -translate-y-1/2';
            const active = room.turn === p.id;
            return (
              <div
                key={p.id}
                ref={(el) => {
                  const map = playerAnchorsRef.current;
                  if (el) map.set(p.id, el);
                  else map.delete(p.id);
                }}
                className={`${common} ${cls}`}
              >
                <div className={`pointer-events-auto select-none flex flex-col items-center gap-1 ${active ? 'animate-pulse' : ''}`}>
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl shadow bg-black/40 text-white transition-transform ${active ? 'ring-4 ring-emerald-400 scale-[3]' : ''}`}
                    aria-label={`Player ${p.name?.slice(0,16)}`}
                    title={p.name?.slice(0,16)}
                  >
                    {p.avatar ? p.avatar : (p.name?.[0] || '?')}
                  </div>
                  <div className="text-white/90 text-xs font-semibold bg-black/40 px-2 py-0.5 rounded-full">{p.name?.slice(0,16)}</div>
                </div>
              </div>
            );
          })}
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
      {played && playedVisual && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center">
          <div className="text-center">
            <div className="mb-3 text-white text-2xl sm:text-3xl drop-shadow">{played.name} played a…</div>
            <div className="inline-block transform origin-center">
              {/* Responsive: ~80vh tall, width maintaining 2:3 card ratio */}
              <div
                ref={playedRef}
                className="relative rounded shadow border overflow-hidden"
                style={{ height: '80vh', width: 'calc(80vh * 0.7)', ...playedStyle }}
              >
                <img src={playedVisual.src} alt={played.card} className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-6xl sm:text-7xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  {playedVisual.label}
                </div>
              </div>
            </div>
          </div>
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
          onClick={async () => {
            if (await confirm("Reset this room? All hands and state will be cleared.")) {
              socket?.emit("resetRoom", { roomCode });
            }
          }}
        >
          Reset Room
        </button>
        <button
          className="px-4 py-2 rounded bg-red-800 text-white disabled:opacity-50"
          disabled={!socket || !roomCode}
          onClick={async () => {
            if (await confirm("Close this room? Everyone will be disconnected and the room code will be invalid.")) {
              socket?.emit("closeRoom", { roomCode });
            }
          }}
        >
          Close Room
        </button>
        <button
          className="px-4 py-2 rounded bg-slate-800 text-white"
          onClick={() => setShowInstructions(true)}
        >
          Instructions
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
                <div ref={discardRef} className="ml-2 flex flex-col items-center" aria-label={`Discard ${room.discardTop}`}>
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
                  return p ? `${p.name?.slice(0,16)} (${w})` : w;
                })()}
              </div>
            )}
            <div>
              <h4 className="font-medium">Players</h4>
              <ul className="list-disc ml-6 text-sm">
                {room.playerCounts.map((p) => (
                  <li key={p.id}>
                    {p.name?.slice(0,16)} (<span className="font-mono">{p.id}</span>): {p.count}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="relative bg-white dark:bg-zinc-900 p-4 rounded max-w-3xl w-[90%] max-h-[80vh] overflow-y-auto">
            <button
              className="absolute top-2 right-2 text-2xl leading-none" 
              onClick={() => setShowInstructions(false)}
              aria-label="Close Instructions"
            >
              ×
            </button>
            <pre className="whitespace-pre-wrap text-sm">{instructions}</pre>
          </div>
        </div>
      )}
    </main>
  );
}
