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
    <div className="relative w-32 h-48 rounded overflow-hidden">
      <Image src={src} alt={code} fill style={{ objectFit: 'cover' }} />
      <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
        {label}
      </div>
    </div>
  );
}

function Flip7Card({ code }: { code: string }) {
  const src = useMemo(() => {
    const map: Record<string, string> = {
      Freeze: '/flip7/F7_Freeze.png',
      Flip3: '/flip7/F7_Flip3.png',
      SecondChance: '/flip7/F7_SecondChance.png',
      x2: '/flip7/F7_Mult2.png',
      '+2': '/flip7/F7_Plus2.png',
      '+4': '/flip7/F7_Plus4.png',
      '+6': '/flip7/F7_Plus6.png',
      '+8': '/flip7/F7_Plus8.png',
      '+10': '/flip7/F7_Plus10.png',
    };
    return map[code] || `/flip7/F7_${code}.png`;
  }, [code]);
  return (
    <div className="relative w-32 h-48 rounded overflow-hidden">
      <Image src={src} alt={code} fill style={{ objectFit: 'cover' }} />
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
  gameId?: string;
  status: "lobby" | "active" | "finished" | "between";
  discardTop: string | null;
  deckCount: number;
  discardCount: number;
  playerCounts: { id: string; name: string; avatar?: string | null; count: number }[];
  turn: string | null;
  winner: string | null;
  flip7?: {
    hands: { id: string; name: string; cards: string[] }[];
    stayed: string[];
    busted: string[];
    frozen: string[];
    roundOver?: boolean;
    pendingFlip3?: string | null;
    pendingFreeze?: string | null;
    pendingSecondChance?: string | null;
    pendingSecondChanceGift?: string | null;
    secondChance?: string[];
    ready?: string[];
  };
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
  const pendingPlayerRef = useRef<string | null>(null);
  const pendingRoomRef = useRef<RoomState | null>(null);
  const animatingRef = useRef(false);

  const finishAnimation = () => {
    setPlayed(null);
    setPlayedStyle(undefined);
    pendingPlayerRef.current = null;
    animatingRef.current = false;
    if (pendingRoomRef.current) {
      setRoom(pendingRoomRef.current);
      pendingRoomRef.current = null;
    }
  };
  const runPlayedAnimation = (playerId: string) => {
    setTimeout(() => {
      const ov = playedRef.current?.getBoundingClientRect();
      const srcAnchor = playerAnchorsRef.current.get(playerId)?.getBoundingClientRect();
      if (!ov || !srcAnchor) {
        const dst = discardRef.current?.getBoundingClientRect();
        if (!ov || !dst) {
          setPlayedStyle({ opacity: 0, transition: 'opacity 900ms ease-in-out' });
          setTimeout(finishAnimation, 950);
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
            setTimeout(finishAnimation, 950);
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
      setPlayedStyle({ transform: `translate(${fromTx}px, ${fromTy}px) scale(0.2)`, opacity: 0 });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPlayedStyle({ transform: 'translate(0px, 0px) scale(1)', opacity: 1, transition: 'transform 450ms ease-out, opacity 450ms ease-out' });
          setTimeout(() => {
            const nowOv = playedRef.current?.getBoundingClientRect();
            const dst = discardRef.current?.getBoundingClientRect();
            if (!nowOv || !dst) {
              setPlayedStyle({ opacity: 0, transition: 'opacity 900ms ease-in-out' });
              setTimeout(finishAnimation, 950);
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
            setTimeout(finishAnimation, 950);
          }, 600);
        });
      });
    }, 50);
  };
  const handlePlayedImageLoad = () => {
    const pid = pendingPlayerRef.current;
    if (pid) runPlayedAnimation(pid);
  };
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    const s = io("/game", { path: "/socket.io" });
    setSocket(s);
    s.on("roomState", (state: RoomState) => {
      if (animatingRef.current) pendingRoomRef.current = state;
      else setRoom(state);
    });
    s.on("cardPlayed", ({ playerId, name, card }: { playerId: string; name: string; card: string }) => {
      if (!card) return;
      setPlayed({ playerId, name: name.slice(0,16), card });
      setPlayedStyle({ opacity: 0 });
      pendingPlayerRef.current = playerId;
      animatingRef.current = true;
    });
    s.on("game-event", ({ message }: { message: string }) => {
      if (/drew a card/i.test(message)) notify("draw", message);
      else notify("notice", message);
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

  useEffect(() => {
    const el = document.querySelector('.container');
    if (!el) return;
    if (room?.gameId === 'flip7') el.classList.add('wide');
    else el.classList.remove('wide');
    return () => el.classList.remove('wide');
  }, [room?.gameId]);
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
    <main className="table-ui">
      <h2 className="text-xl font-semibold">Table</h2>
      {/* Player avatars along bottom */}
      {room && room.playerCounts?.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-20 flex gap-4">
          {room.playerCounts.map((p) => {
            const active = room.turn === p.id;
            return (
              <div
                key={p.id}
                ref={(el) => {
                  const map = playerAnchorsRef.current;
                  if (el) map.set(p.id, el); else map.delete(p.id);
                }}
                className="flex flex-col items-center"
              >
                <div
                  className={`pointer-events-auto select-none w-20 h-20 rounded-full flex items-center justify-center text-4xl shadow bg-black/40 text-white transition-transform ${active ? 'animate-pulse ring-4 ring-emerald-400' : ''}`}
                  aria-label={`Player ${p.name?.slice(0,16)}`}
                  title={p.name?.slice(0,16)}
                >
                  {p.avatar ? p.avatar : (p.name?.[0] || '?')}
                </div>
                <div className="mt-1 text-white/90 text-xs font-semibold bg-black/40 px-2 py-0.5 rounded-full">{p.name?.slice(0,16)}</div>
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
                className="relative rounded overflow-hidden"
                style={{ height: '80vh', width: 'calc(80vh * 0.7)', ...playedStyle }}
              >
                <img src={playedVisual.src} alt={played.card} className="absolute inset-0 w-full h-full object-cover" onLoad={handlePlayedImageLoad} />
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
            <option value="flip7">Flip 7</option>
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
            <div className="text-sm">
              {room.gameId === 'flip7' ? (
                <div className="flex flex-col gap-2">
                  {room.flip7?.hands.map(p => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div className="font-semibold">
                        {p.name}
                        {room.flip7?.stayed.includes(p.id) ? ' (Stayed)' : ''}
                      </div>
                      <div className="relative flex gap-1">
                        {p.cards.map((c, i) => (
                          <Flip7Card key={i} code={c} />
                        ))}
                        {room.flip7?.busted.includes(p.id) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
                            <span className="text-red-600 font-bold">BUSTED</span>
                          </div>
                        )}
                        {(room.flip7?.frozen || []).includes(p.id) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
                            <span className="text-blue-600 font-bold">FROZEN</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-end gap-4">
                  <div>
                    <span className="font-mono text-xs">Draw Deck</span>
                    <div className="relative w-32 h-48">
                      {Array.from({ length: Math.min(5, room.deckCount) }).map((_, i) => (
                        <div key={i} className="absolute w-full h-full rounded overflow-hidden" style={{ transform: `translate(${i*2}px, ${i*1}px)` }}>
                          <Image src="/uno/uno_back.png" alt="Card Back" fill style={{ objectFit: 'cover' }} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 text-center text-[10px] leading-none font-mono text-gray-700 dark:text-gray-300">
                      {room.deckCount} cards
                    </div>
                  </div>
                  <div>
                    <span className="font-mono text-xs">Discard Pile</span>
                    {room.discardTop ? (
                      <div ref={discardRef} className="relative w-32 h-48" aria-label={`Discard ${room.discardTop}`}> 
                        {Array.from({ length: Math.min(5, room.discardCount) }).map((_, i) => (
                          <div key={i} className="absolute w-full h-full" style={{ transform: `translate(${i*2}px, ${i*1}px)` }}>
                            <UnoCard code={room.discardTop!} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="relative w-32 h-48 border-2 border-dashed rounded border-white/20 flex items-center justify-center">
                        <span className="text-xs text-white/40">Empty</span>
                      </div>
                    )}
                    <div className="mt-1 text-center text-[10px] leading-none font-mono text-gray-700 dark:text-gray-300" aria-hidden>
                      {room.discardCount} cards
                    </div>
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
            {room.gameId !== 'flip7' && (
              <div>
                <h4 className="font-medium">Players</h4>
                <table className="w-full text-sm mt-2">
                  <thead>
                    <tr className="text-left">
                      <th className="p-2">Name</th>
                      <th className="p-2">ID</th>
                      <th className="p-2">Cards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {room.playerCounts.map((p) => (
                      <tr key={p.id} className="border-t border-white/10">
                        <td className="p-2">{p.name?.slice(0,16)}</td>
                        <td className="p-2 font-mono">{p.id}</td>
                        <td className="p-2">{p.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
