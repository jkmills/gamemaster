"use client";
import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import Image from "next/image";
import { useNotifications } from "../../components/Notifications";

function randomId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function UnoCard({ code, large = false }: { code: string; large?: boolean }) {
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
    <div className={`relative ${large ? 'w-28 h-40' : 'w-14 h-20'} rounded overflow-hidden`}>
      <Image src={src} alt={code} fill style={{ objectFit: 'cover' }} />
      <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
        {label}
      </div>
    </div>
  );
}

function Flip7Card({ code, large = false }: { code: string; large?: boolean }) {
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
    <div className={`relative ${large ? 'w-28 h-40' : 'w-14 h-20'} rounded overflow-hidden`}>
      <Image src={src} alt={code} fill style={{ objectFit: 'cover' }} />
    </div>
  );
}

function isLegalPlay(card: string, top: string | null) {
  if (!top) return true;
  if (card === 'W' || card === 'W+4') return true;
  const tIsWild = top[0] === 'W';
  const cColor = card[0];
  const cSym = card.slice(1);
  if (tIsWild) {
    const tChosen = top.replace('W','').replace('+4','')[0];
    if (!tChosen) return true;
    return cColor === tChosen;
  }
  const tColor = top[0];
  const tSym = top.slice(1);
  return cColor === tColor || cSym === tSym;
}

type RoomState = {
  code: string;
  gameId?: string;
  status: "lobby" | "active" | "finished" | "between";
  discardTop: string | null;
  playerCounts: { id: string; name: string; avatar?: string | null; count: number }[];
  turn: string | null;
  winner?: string | null;
  log?: string[];
  flip7?: {
    scores: { id: string; name: string; score: number }[];
    roundScore: { id: string; name: string; score: number }[];
    stayed: string[];
    busted: string[];
    frozen: string[];
    uniquesCount: { id: string; name: string; count: number }[];
    roundOver: boolean;
    hands?: { id: string; name: string; cards: string[] }[];
    pendingFlip3?: string | null;
    pendingFreeze?: string | null;
    pendingSecondChance?: string | null;
    pendingSecondChanceGift?: string | null;
    secondChance?: string[];
    ready?: string[];
  };
};

export default function MobilePage() {
  const { notify, confirm } = useNotifications();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [playerId, setPlayerId] = useState<string>(() => randomId());
  const [joined, setJoined] = useState(false);
  const [hand, setHand] = useState<string[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [wildPick, setWildPick] = useState<{ index: number } | null>(null);
  const avatarOptions = useMemo(() => ['😀','😎','🐱','🐶','🦊','🐼','🐸','🐵','🐧','🐯','🐻','🐨','🦄','🐲','🚀','🎩'], []);
  const [avatar, setAvatar] = useState<string>(avatarOptions[0]);
  const [showPlayable, setShowPlayable] = useState(false);

  useEffect(() => {
    const el = document.querySelector('.container');
    if (!el) return;
    if (room?.gameId === 'flip7') el.classList.add('wide');
    else el.classList.remove('wide');
    return () => el.classList.remove('wide');
  }, [room?.gameId]);

  useEffect(() => {
    // hydrate from localStorage and URL (?code=...)
    try {
      const saved = JSON.parse(localStorage.getItem("gm.session") || "null");
      if (saved && saved.playerId && saved.roomCode) {
        setPlayerId(saved.playerId);
        setRoomCode(saved.roomCode);
        if (saved.name) setName(saved.name.slice(0,16));
        if (saved.joined) setJoined(true);
        if (saved.avatar) setAvatar(saved.avatar);
      }
      // allow QR prefill
      const params = new URLSearchParams(window.location.search);
      const qrCode = params.get('code');
      if (qrCode && !saved?.roomCode) {
        setRoomCode(qrCode.toUpperCase());
      }
    } catch {}

    const s = io("/game", { path: "/socket.io" });
    setSocket(s);
    s.on("roomState", (state: RoomState) => {
      setRoom(state);
      // ensure hand stays in sync after refresh/reconnect
      try {
        const saved = JSON.parse(localStorage.getItem("gm.session") || "null");
        const pid = saved?.playerId || playerId;
        if (saved?.joined && pid && state?.code) {
          s.emit("getHand", { roomCode: state.code, playerId: pid });
        }
      } catch {}
    });
    s.on("playerHand", (p: { hand: string[] }) => setHand(p.hand));
    s.on("notice", (n: { message?: string }) => {
      if (!n?.message) return;
      if (/you drew/i.test(n.message)) notify("draw", n.message);
      else notify("notice", n.message);
    });
    s.on("error", (e: { message?: string }) => {
      if (e?.message) notify("error", e.message);
    });
    s.on("connect", () => {
      // auto rejoin and fetch hand using latest persisted session (avoid stale closures)
      try {
        const saved = JSON.parse(localStorage.getItem("gm.session") || "null");
        if (saved && saved.joined && saved.roomCode && saved.playerId && saved.name) {
          s.emit("joinRoom", { roomCode: saved.roomCode, playerId: saved.playerId, name: saved.name.slice(0,16), avatar: saved.avatar });
          s.emit("getHand", { roomCode: saved.roomCode, playerId: saved.playerId });
        }
      } catch {}
    });
    s.on("connect_error", (e) => console.error(e));
    s.on("roomClosed", ({ roomCode: rc }: { roomCode: string }) => {
      notify("notice", `Room ${rc} was closed.`);
      setJoined(false);
      setRoom(null);
      setHand([]);
      try { localStorage.removeItem('gm.session'); } catch {}
    });
    return () => {
      s.disconnect();
    };
  }, []);

  // Warn before accidental tab close/refresh while joined
  useEffect(() => {
    if (!joined) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [joined]);

  // Keep device awake during play
  useEffect(() => {
    if (!joined) return;
    let wakeLock: any = null;
    const request = async () => {
      try {
        wakeLock = await (navigator as any).wakeLock?.request('screen');
      } catch {}
    };
    request();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') request();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      try { wakeLock?.release?.(); } catch {}
    };
  }, [joined]);

  const myTurn = useMemo(() => {
    if (!room) return false;
    return room.status === 'active' && room.turn === playerId;
  }, [room, playerId]);
  const winnerName = useMemo(() => {
    if (!room?.winner) return null;
    const p = room.playerCounts?.find(p => p.id === room.winner);
    return p?.name || room.winner;
  }, [room]);

  const join = () => {
    if (!socket || !roomCode || !name) return;
    const normalized = roomCode.trim().toUpperCase();
    const trimmedName = name.trim().slice(0,16);
    setRoomCode(normalized); // ensure subsequent emits match server room key
    socket.emit("joinRoom", { roomCode: normalized, playerId, name: trimmedName, avatar });
    setJoined(true);
    // persist session
    try {
      localStorage.setItem(
        "gm.session",
    JSON.stringify({ roomCode: normalized, playerId, name: trimmedName, avatar, joined: true })
      );
    } catch {}
  };

  const draw = () => socket?.emit("drawCard", { roomCode, playerId });
  const pass = () => socket?.emit("passTurn", { roomCode, playerId });
  const flip7Hit = () => socket?.emit("flip7:hit", { roomCode, playerId });
  const flip7Stay = () => socket?.emit("flip7:stay", { roomCode, playerId });
  const flip3Target = (targetId: string) => socket?.emit("flip7:flip3Target", { roomCode, playerId, targetId });
  const freezeTarget = (targetId: string) => socket?.emit("flip7:freezeTarget", { roomCode, playerId, targetId });
  const useSecondChance = () => socket?.emit("flip7:useSecondChance", { roomCode, playerId });
  const giftSecondChance = (targetId: string) => socket?.emit("flip7:giftSecondChance", { roomCode, playerId, targetId });
  const startNextRound = () => socket?.emit("flip7:startNextRound", { roomCode, playerId });
  const play = (idx: number) => {
    if (!socket) return;
    const card = hand[idx];
    if (card === 'W' || card === 'W+4') {
      setWildPick({ index: idx });
      return;
    }
    socket.emit("playCard", { roomCode, playerId, cardIndex: idx });
  };

  const leave = async () => {
    if (!(await confirm("Leave this room?"))) return;
    if (socket && roomCode) {
      socket.emit("leaveRoom", { roomCode, playerId });
    }
    setJoined(false);
    setRoom(null);
    setHand([]);
    try { localStorage.removeItem("gm.session"); } catch {}
  };

  const changeRoom = async () => {
    if (!(await confirm("Reset and change rooms?"))) return;
    // Reset client state to allow joining a different room; keep name and playerId
    setJoined(false);
    setRoom(null);
    setHand([]);
    try { localStorage.removeItem("gm.session"); } catch {}
  };

  return (
    <>
    <main className={`space-y-4 transition-colors pb-16 ${myTurn ? 'bg-emerald-300 dark:bg-emerald-700 ring-8 ring-emerald-500 -mx-4 px-4 py-2 rounded shadow-xl' : ''}`}>
      {joined && (
        <button
          className={`fixed top-2 right-2 z-50 p-2 rounded-full bg-white/80 dark:bg-black/40 ${showPlayable ? 'text-emerald-600' : ''}`}
          onClick={() => setShowPlayable(v => !v)}
          aria-label="Toggle playable cards"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 5c-7.633 0-11 7-11 7s3.367 7 11 7 11-7 11-7-3.367-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/></svg>
        </button>
      )}
      <h2 className="text-xl font-semibold">Mobile</h2>
      {room?.winner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="text-center text-white">
            <div className="text-2xl font-semibold">Winner</div>
            <div className="mt-2 text-4xl sm:text-5xl font-extrabold">{winnerName}</div>
            <div className="mt-6 flex gap-3 justify-center">
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white"
                onClick={() => room && socket?.emit('restartGame', { roomCode: room.code })}
              >Play Again</button>
              <button
                className="px-4 py-2 rounded bg-red-600 text-white"
                onClick={leave}
              >Leave Room</button>
            </div>
          </div>
        </div>
      )}

      {wildPick && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="rounded-lg shadow border bg-white dark:bg-zinc-900 p-4 w-72">
            <div className="text-center font-semibold mb-3">Choose Wild Color</div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { c:'R', name:'Red', cls:'bg-red-600' },
                { c:'G', name:'Green', cls:'bg-green-600' },
                { c:'B', name:'Blue', cls:'bg-blue-600' },
                { c:'Y', name:'Yellow', cls:'bg-yellow-500 text-black' },
              ] as const).map(({c,name,cls}) => (
                <button
                  key={c}
                  className={`px-3 py-3 rounded text-white font-semibold ${cls}`}
                  onClick={() => {
                    const idx = wildPick.index;
                    setWildPick(null);
                    socket?.emit('playCard', { roomCode, playerId, cardIndex: idx, chosenColor: c });
                  }}
                  aria-label={`Choose ${name}`}
                >{name}</button>
              ))}
            </div>
            <button
              className="mt-3 w-full px-3 py-2 rounded bg-slate-600 text-white"
              onClick={() => setWildPick(null)}
            >Cancel</button>
          </div>
        </div>
      )}

    {!joined ? (
      <div className="space-y-3 pb-12">
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
          <span className="text-sm">Your Name</span>
          <input
            className="block mt-1 border rounded px-3 py-2 w-full bg-white/80 dark:bg-black/20"
            placeholder="e.g. Alex"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value.slice(0,16))}
          />
        </label>
        <div>
          <div className="text-sm mb-1">Choose an Avatar</div>
          <div className="grid grid-cols-8 gap-2">
            {avatarOptions.map((a) => (
              <button
                key={a}
                type="button"
                className={`h-12 w-12 rounded-full flex items-center justify-center text-2xl shadow border ${avatar === a ? 'ring-2 ring-emerald-500 bg-emerald-50 dark:bg-emerald-900/30' : 'bg-white/80 dark:bg-black/20'}`}
                onClick={() => setAvatar(a)}
                aria-label={`Select avatar ${a}`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={!roomCode || !name}
            onClick={join}
          >
            Join
          </button>
          <button
            className="px-4 py-2 rounded bg-slate-600 text-white"
            onClick={changeRoom}
          >
            Change Room
          </button>
        </div>
      </div>
    ) : (
      <div className="space-y-3 pb-12">
        <div className="text-sm flex items-center gap-2">Discard Top: <span className="font-mono">{room?.discardTop ?? "—"}</span>
          {room?.discardTop && (
            <div className="ml-2 flex flex-col items-center" aria-label={`Discard ${room.discardTop}`}>
              <UnoCard code={room.discardTop} large />
              <div className="mt-1 text-[10px] leading-none font-mono text-gray-700 dark:text-gray-300" aria-hidden>
                {room.discardTop}
              </div>
            </div>
          )}
          </div>
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
                <h3 className="font-medium mb-1">My Cards</h3>
                <div className="relative">
                  <div className="flex flex-wrap gap-3 opacity-100">
                  {hand.map((c, idx) => (
                    <Flip7Card key={`${c}-${idx}`} code={c} />
                  ))}
                </div>
                {room.flip7?.busted.includes(playerId) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                    <span className="text-red-600 font-bold text-3xl">BUSTED</span>
                  </div>
                )}
                {(room.flip7?.frozen || []).includes(playerId) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                    <span className="text-blue-600 font-bold text-3xl">FROZEN</span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <h3 className="font-medium mb-1">Round</h3>
                <div className="text-xs">Stayed: {room.flip7?.stayed.join(', ') || '—'}</div>
                <div className="text-xs">Frozen: {(room.flip7?.frozen || []).join(', ') || '—'}</div>
                <div className="text-xs">Busted: {room.flip7?.busted.join(', ') || '—'}</div>
                <div className="mt-1 text-xs">Uniques: {room.flip7?.uniquesCount.map(u => `${u.name}:${u.count}`).join(' | ') || '—'}</div>
                <div className="mt-1 text-xs">Round Scores: {room.flip7?.roundScore.map(s => `${s.name}:${s.score}`).join(' | ') || '—'}</div>
                <div className="mt-1 text-xs">Total Scores: {room.flip7?.scores.map(s => `${s.name}:${s.score}`).join(' | ') || '—'}</div>
              </div>
              {room.flip7?.pendingFlip3 === playerId && (
                <div className="mt-2">
                  <h3 className="font-medium mb-1">Choose player for Flip3</h3>
                  <div className="flex flex-wrap gap-2">
                    {room.flip7?.hands
                      ?.filter(
                        p =>
                          !(room.flip7?.frozen || []).includes(p.id) &&
                          !(room.flip7?.busted || []).includes(p.id)
                      )
                      .map(p => (
                        <button
                          key={p.id}
                          className="px-2 py-1 rounded bg-amber-600 text-white"
                          onClick={() => flip3Target(p.id)}
                        >
                          {p.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
              {room.flip7?.pendingFreeze === playerId && (
                <div className="mt-2">
                  <h3 className="font-medium mb-1">Choose player to Freeze</h3>
                  <div className="flex flex-wrap gap-2">
                    {room.flip7?.hands
                      ?.filter(
                        p =>
                          !(room.flip7?.frozen || []).includes(p.id) &&
                          !(room.flip7?.busted || []).includes(p.id)
                      )
                      .map(p => (
                        <button
                          key={p.id}
                          className="px-2 py-1 rounded bg-amber-600 text-white"
                          onClick={() => freezeTarget(p.id)}
                        >
                          {p.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
              {room.flip7?.pendingSecondChance === playerId && (
                <div className="mt-2">
                  <button className="px-4 py-2 rounded bg-green-600 text-white" onClick={useSecondChance}>
                    Use Your Second Chance
                  </button>
                </div>
              )}
              {room.flip7?.pendingSecondChanceGift === playerId && (
                <div className="mt-2">
                  <h3 className="font-medium mb-1">Give Second Chance to</h3>
                  <div className="flex flex-wrap gap-2">
                    {room.flip7?.hands
                      ?.filter(
                        p =>
                          p.id !== playerId &&
                          !(room.flip7?.secondChance || []).includes(p.id) &&
                          !(room.flip7?.frozen || []).includes(p.id) &&
                          !(room.flip7?.busted || []).includes(p.id)
                      )
                      .map(p => (
                        <button key={p.id} className="px-2 py-1 rounded bg-amber-600 text-white" onClick={() => giftSecondChance(p.id)}>
                          {p.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
              {room.status === 'between' ? (
                <div className="flex gap-2">
                  {room.flip7?.ready?.includes(playerId) ? (
                    <span className="px-4 py-2">Waiting for others...</span>
                  ) : (
                    <button className="px-4 py-2 rounded bg-green-600 text-white" onClick={startNextRound}>
                      Start Next Round
                    </button>
                  )}
                  <button className="px-4 py-2 rounded bg-amber-600 text-white" onClick={changeRoom}>Change Room</button>
                  <button className="px-4 py-2 rounded bg-red-600 text-white" onClick={leave}>Leave Room</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                    disabled={!socket || !roomCode || !myTurn}
                    onClick={() => {
                      if (!myTurn) { notify("error", 'Not your turn'); return; }
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
              )}
            </>
          ) : (
            <>
              <div>
                <h3 className="font-medium mb-1">My Hand</h3>
                <div className="flex flex-wrap gap-3">
                  {hand.map((c, idx) => {
                    const playable = isLegalPlay(c, room?.discardTop || null);
                    const disabled = !myTurn || (showPlayable && !playable);
                    return (
                      <div key={`${c}-${idx}`} className="flex flex-col items-center">
                        <button
                          onClick={() => !disabled && play(idx)}
                          className={`rounded ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                          disabled={disabled}
                          title={myTurn ? "Play" : "Wait for your turn"}
                          aria-label={`Card ${c}`}
                        >
                          <UnoCard code={c} />
                        </button>
                        <div className="mt-1 text-[10px] leading-none font-mono text-gray-700 dark:text-gray-300" aria-hidden>
                          {c}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                  disabled={!socket || !roomCode || !myTurn}
                  onClick={() => draw()}
                >
                  Draw
                </button>
                <button className="px-4 py-2 rounded bg-amber-600 text-white" onClick={changeRoom}>Change Room</button>
                <button className="px-4 py-2 rounded bg-red-600 text-white" onClick={leave}>Leave Room</button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
    <div className="fixed bottom-0 left-0 right-0 text-[10px] sm:text-xs flex justify-around gap-2 p-1 bg-white/70 dark:bg-black/70">
      <span>Room: <span className="font-mono">{(room?.code ?? roomCode) || '—'}</span></span>
      <span>Game: {room?.gameId ?? '—'}</span>
      <span>Status: {room?.status ?? '—'}</span>
      <span>My Turn: {myTurn ? 'Yes' : 'No'}</span>
    </div>
    </>
  );
}
