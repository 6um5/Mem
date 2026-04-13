import React, { useState, useEffect, useCallback } from 'react';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  increment,
  getDocFromServer,
  deleteField
} from 'firebase/firestore';
import { auth, db, loginAnonymously } from './lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Trophy, 
  Clock, 
  Send, 
  Crown, 
  LogOut, 
  Plus, 
  Play, 
  ChevronRight,
  UserMinus,
  AlertCircle,
  Upload,
  RefreshCw,
  Image as ImageIcon
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const safeUpdateDoc = async (ref: any, data: any) => {
  const cleanData = Object.fromEntries(
    Object.entries(data).filter(([_, v]) => v !== undefined)
  );
  if (Object.keys(cleanData).length > 0) {
    await updateDoc(ref, cleanData);
  }
};

// --- Types ---
type GameStatus = 'lobby' | 'selecting' | 'writing' | 'revealing' | 'voting' | 'results' | 'winner';

interface Player {
  name: string;
  points: number;
  isOnline: boolean;
  lastSeen: any;
}

interface RoomSettings {
  maxPoints: number;
  roundTime: number;
}

interface Meme {
  url: string;
  title: string;
}

interface RoomData {
  hostId: string;
  status: GameStatus;
  settings: RoomSettings;
  currentMeme?: Meme;
  memeOptions?: Meme[];
  players: Record<string, Player>;
  captions?: Record<string, string>;
  votes?: Record<string, string>;
  revealIndex?: number;
  roundEndTime?: any;
  winner?: string;
}

// --- Components ---

const Footer = () => (
  <footer className="mt-auto py-8 text-center">
    <div className="inline-block bg-white/10 backdrop-blur-md px-6 py-3 rounded-full border border-white/20 shadow-xl">
      <p className="text-white font-medium tracking-wide">
        تم التطوير بكل حب بواسطه <span className="text-yellow-400 font-bold">علوش زياد</span> لعيون <span className="text-red-500 font-bold">طوكيو</span> بس ❤️
      </p>
    </div>
  </footer>
);

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomData | null>(null);
  const [playerName, setPlayerName] = useState(localStorage.getItem('meme_battle_name') || '');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize Auth
  useEffect(() => {
    loginAnonymously().then(setUser);
  }, []);

  // Listen to Room
  useEffect(() => {
    if (!roomId) return;
    const unsub = onSnapshot(doc(db, 'rooms', roomId), (snapshot) => {
      if (snapshot.exists()) {
        setRoom(snapshot.data() as RoomData);
      } else {
        setRoomId(null);
        setRoom(null);
      }
    });
    return () => unsub();
  }, [roomId]);

  // Presence logic
  useEffect(() => {
    if (!roomId || !user || !room) return;
    
    const updatePresence = async () => {
      if (user?.uid && room.players[user.uid]) {
        await safeUpdateDoc(doc(db, 'rooms', roomId), {
          [`players.${user.uid}.isOnline`]: true,
          [`players.${user.uid}.lastSeen`]: serverTimestamp()
        });
      }
    };

    updatePresence();
    
    // Handle disconnect (best effort)
    const handleVisibility = () => {
      if (!user?.uid) return;
      if (document.visibilityState === 'hidden') {
        safeUpdateDoc(doc(db, 'rooms', roomId), {
          [`players.${user.uid}.isOnline`]: false
        });
      } else {
        safeUpdateDoc(doc(db, 'rooms', roomId), {
          [`players.${user.uid}.isOnline`]: true
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [roomId, user?.uid, !!room]);

  const createRoom = async () => {
    if (!playerName.trim() || !user) return;
    localStorage.setItem('meme_battle_name', playerName);
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initialRoom: RoomData = {
      hostId: user.uid,
      status: 'lobby',
      settings: { maxPoints: 5, roundTime: 60 },
      players: {
        [user.uid]: {
          name: playerName,
          points: 0,
          isOnline: true,
          lastSeen: serverTimestamp()
        }
      }
    };
    await setDoc(doc(db, 'rooms', newRoomId), initialRoom);
    setRoomId(newRoomId);
  };

  const joinRoom = async (id: string) => {
    if (!playerName.trim() || !user?.uid) return;
    localStorage.setItem('meme_battle_name', playerName);
    const roomRef = doc(db, 'rooms', id.toUpperCase());
    const snap = await getDocFromServer(roomRef);
    
    if (snap.exists()) {
      const data = snap.data() as RoomData;
      // Reconnection logic: if user was already in the room, just update online status
      if (user.uid && data.players[user.uid]) {
        await safeUpdateDoc(roomRef, {
          [`players.${user.uid}.isOnline`]: true,
          [`players.${user.uid}.name`]: playerName // Update name if changed
        });
      } else if (user.uid) {
        await safeUpdateDoc(roomRef, {
          [`players.${user.uid}`]: {
            name: playerName,
            points: 0,
            isOnline: true,
            lastSeen: serverTimestamp()
          }
        });
      }
      setRoomId(id.toUpperCase());
    } else {
      setError('الغرفة غير موجودة!');
    }
  };

  const leaveRoom = async () => {
    if (!roomId || !user?.uid || !room) return;
    const newPlayers = { ...room.players };
    delete newPlayers[user.uid];
    
    // If host leaves, we could assign a new host or just let it be. 
    // For simplicity, we just remove the player.
    await safeUpdateDoc(doc(db, 'rooms', roomId), { players: newPlayers });
    setRoomId(null);
    setRoom(null);
  };

  const kickPlayer = async (uid: string) => {
    if (!roomId || !room || room.hostId !== user?.uid) return;
    const newPlayers = { ...room.players };
    delete newPlayers[uid];
    await safeUpdateDoc(doc(db, 'rooms', roomId), { players: newPlayers });
  };

  const startGame = async () => {
    if (!roomId || !room || room.hostId !== user?.uid) return;
    await nextRound();
  };

  const nextRound = async () => {
    if (!roomId || !room) return;
    
    // Fallback list of classic, universally funny meme templates
    const fallbackMemes: Meme[] = [
      { url: 'https://i.imgflip.com/1otk96.jpg', title: 'Distracted Boyfriend' },
      { url: 'https://i.imgflip.com/26am.jpg', title: 'Two Buttons' },
      { url: 'https://i.imgflip.com/1g8my4.jpg', title: 'Think About It' },
      { url: 'https://i.imgflip.com/9ehk.jpg', title: 'Batman Slapping Robin' },
      { url: 'https://i.imgflip.com/gr1t.jpg', title: 'Change My Mind' },
      { url: 'https://i.imgflip.com/1ur9b0.jpg', title: 'Drake Hotline Bling' },
      { url: 'https://i.imgflip.com/26nbx1.jpg', title: 'Exit 12 Off Ramp' },
      { url: 'https://i.imgflip.com/43a45p.png', title: 'Always Has Been' }
    ];

    try {
      const memes: Meme[] = [];
      const usedUrls = new Set<string>();

      // Fetch top blank meme templates from Imgflip API
      try {
        const res = await fetch('https://api.imgflip.com/get_memes');
        const json = await res.json();
        
        if (json.success) {
          const allMemes = json.data.memes;
          // Shuffle the top 100 memes
          const shuffled = allMemes.sort(() => 0.5 - Math.random());
          
          for (let i = 0; i < shuffled.length && memes.length < 3; i++) {
            if (!usedUrls.has(shuffled[i].url)) {
              memes.push({ url: shuffled[i].url, title: shuffled[i].name });
              usedUrls.add(shuffled[i].url);
            }
          }
        }
      } catch (e) {
        console.error("Imgflip fetch failed", e);
      }

      // Fill remaining slots with fallback memes if API fails
      while (memes.length < 3) {
        const randomFallback = fallbackMemes[Math.floor(Math.random() * fallbackMemes.length)];
        if (!usedUrls.has(randomFallback.url)) {
          memes.push(randomFallback);
          usedUrls.add(randomFallback.url);
        }
      }

      await safeUpdateDoc(doc(db, 'rooms', roomId), {
        status: 'selecting',
        memeOptions: memes,
        currentMeme: deleteField(),
        captions: {},
        votes: {},
        revealIndex: 0
      });
    } catch (e) {
      console.error(e);
    }
  };

  const selectMeme = async (meme: Meme) => {
    if (!roomId || !room) return;
    await safeUpdateDoc(doc(db, 'rooms', roomId), {
      status: 'writing',
      currentMeme: meme,
      memeOptions: deleteField(),
      roundEndTime: new Date(Date.now() + room.settings.roundTime * 1000)
    });
  };

  const submitCaption = async (text: string) => {
    if (!roomId || !user?.uid) return;
    await safeUpdateDoc(doc(db, 'rooms', roomId), {
      [`captions.${user.uid}`]: text
    });
  };

  const submitVote = async (targetUid: string) => {
    if (!roomId || !user?.uid || room?.status !== 'voting') return;
    await safeUpdateDoc(doc(db, 'rooms', roomId), {
      [`votes.${user.uid}`]: targetUid
    });
  };

  const advanceReveal = async () => {
    if (!roomId || !room || room.hostId !== user?.uid) return;
    const captionCount = Object.keys(room.captions || {}).length;
    if ((room.revealIndex || 0) < captionCount - 1) {
      await safeUpdateDoc(doc(db, 'rooms', roomId), {
        revealIndex: increment(1)
      });
    } else {
      await safeUpdateDoc(doc(db, 'rooms', roomId), {
        status: 'voting'
      });
    }
  };

  const calculateResults = async () => {
    if (!roomId || !room || room.hostId !== user?.uid) return;
    
    const voteCounts: Record<string, number> = {};
    Object.values(room.votes || {}).forEach((uid: string) => {
      voteCounts[uid] = (voteCounts[uid] || 0) + 1;
    });

    let winnerUid = '';
    let maxVotes = -1;
    Object.entries(voteCounts).forEach(([uid, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        winnerUid = uid;
      }
    });

    if (winnerUid) {
      const winnerPlayer = room.players[winnerUid as keyof typeof room.players];
      const newPoints = (winnerPlayer?.points || 0) + 1;
      const updates: any = {
        status: 'results',
        [`players.${winnerUid}.points`]: newPoints
      };

      if (newPoints >= room.settings.maxPoints) {
        updates.status = 'winner';
        updates.winner = winnerUid;
      }

      await safeUpdateDoc(doc(db, 'rooms', roomId), updates);
    } else {
      await safeUpdateDoc(doc(db, 'rooms', roomId), { status: 'results' });
    }
  };

  if (!user) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">جاري التحميل...</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30 flex flex-col overflow-x-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 flex-grow container mx-auto px-4 py-8 flex flex-col items-center">
        <AnimatePresence mode="wait">
          {!roomId ? (
            <motion.div 
              key="lobby-join"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md space-y-8 mt-12"
            >
              <div className="text-center space-y-4">
                <motion.h1 
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400"
                >
                  MEME BATTLE
                </motion.h1>
                <p className="text-slate-400 text-lg">أثبت أنك ملك الميمز في معركة الكوميديا</p>
              </div>

              <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">اسمك المستعار</label>
                  <input 
                    type="text" 
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="أدخل اسمك هنا..."
                    className="w-full bg-slate-900/50 border border-white/10 rounded-2xl px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={createRoom}
                    disabled={!playerName.trim()}
                    className="flex flex-col items-center justify-center p-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl transition-all group shadow-lg shadow-indigo-600/20"
                  >
                    <Plus className="w-8 h-8 mb-2 group-hover:scale-110 transition-transform" />
                    <span className="font-bold">إنشاء غرفة</span>
                  </button>
                  <button 
                    onClick={() => setIsJoining(true)}
                    disabled={!playerName.trim()}
                    className="flex flex-col items-center justify-center p-6 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 rounded-2xl transition-all group"
                  >
                    <Users className="w-8 h-8 mb-2 group-hover:scale-110 transition-transform" />
                    <span className="font-bold">انضمام</span>
                  </button>
                </div>

                {isJoining && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="pt-4 space-y-4"
                  >
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="كود الغرفة (مثال: ABCD)"
                        className="w-full bg-slate-900/50 border border-white/10 rounded-2xl px-5 py-4 text-center text-2xl font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') joinRoom((e.target as HTMLInputElement).value);
                        }}
                      />
                    </div>
                  </motion.div>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl border border-red-400/20">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm font-medium">{error}</span>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <GameView 
              user={user}
              room={room!}
              roomId={roomId}
              onKick={kickPlayer}
              onStart={startGame}
              onNext={nextRound}
              onSelectMeme={selectMeme}
              onSubmitCaption={submitCaption}
              onAdvanceReveal={advanceReveal}
              onVote={submitVote}
              onCalculateResults={calculateResults}
              onLeave={leaveRoom}
            />
          )}
        </AnimatePresence>
      </main>

      <Footer />
    </div>
  );
}

function CustomImageSelector({ onSelectMeme }: { onSelectMeme: (meme: Meme) => void }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
    setPreview(e.target.value);
    setError(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const MAX_WIDTH = 800;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        setPreview(base64);
        setUrl(base64);
        setError(null);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 shadow-xl mt-8">
      <h3 className="text-lg font-bold text-indigo-400">أو استخدم صورة من اختيارك (رفع من الجهاز أو رابط):</h3>
      
      <div className="flex flex-col sm:flex-row gap-3">
        <input 
          type="url" 
          value={url.startsWith('data:') ? '' : url}
          onChange={handleUrlChange}
          placeholder="ضع رابط الصورة هنا (URL)..."
          className="flex-grow bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-left dir-ltr focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <label className="bg-slate-800 hover:bg-slate-700 px-6 py-3 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-2">
          <Upload className="w-5 h-5" />
          رفع صورة
          <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>

      {preview && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-400">معاينة الصورة:</p>
          <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-white/10 flex items-center justify-center">
            <img 
              src={preview} 
              alt="Preview" 
              className="max-w-full max-h-full object-contain"
              onError={() => {
                setError('تعذر تحميل الصورة. تأكد من الرابط أو جرب صورة أخرى.');
                setPreview(null);
              }}
              referrerPolicy="no-referrer"
            />
          </div>
          {error ? (
            <p className="text-red-400 text-sm font-bold">{error}</p>
          ) : (
            <button 
              onClick={() => onSelectMeme({ url: preview, title: 'صورة مخصصة' })}
              className="w-full bg-indigo-600 hover:bg-indigo-500 px-6 py-4 rounded-xl font-bold transition-all text-lg shadow-lg shadow-indigo-600/20"
            >
              استخدام هذه الصورة
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GameView({ 
  user, 
  room, 
  roomId, 
  onKick, 
  onStart, 
  onNext, 
  onSelectMeme,
  onSubmitCaption,
  onAdvanceReveal,
  onVote,
  onCalculateResults,
  onLeave
}: { 
  user: any, 
  room: RoomData, 
  roomId: string,
  onKick: (uid: string) => void,
  onStart: () => void,
  onNext: () => void,
  onSelectMeme: (meme: Meme) => void,
  onSubmitCaption: (text: string) => void,
  onAdvanceReveal: () => void,
  onVote: (uid: string) => void,
  onCalculateResults: () => void,
  onLeave: () => void
}) {
  const isHost = room.hostId === user.uid;
  const [caption, setCaption] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (room.status === 'writing' && room.roundEndTime) {
      const interval = setInterval(() => {
        const diff = Math.max(0, Math.floor((room.roundEndTime.toDate() - Date.now()) / 1000));
        setTimeLeft(diff);
        if (diff === 0 && isHost) {
          safeUpdateDoc(doc(db, 'rooms', roomId), { status: 'revealing' });
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [room.status, room.roundEndTime, isHost, roomId]);

  return (
    <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-4 gap-8">
      {/* Sidebar: Players */}
      <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              اللاعبون
            </h2>
            <div className="bg-indigo-500/20 text-indigo-400 px-3 py-1 rounded-full text-xs font-bold font-mono">
              {roomId}
            </div>
          </div>
          
          <div className="space-y-3">
            {Object.entries(room.players).map(([uid, player]) => (
              <div 
                key={uid}
                className={cn(
                  "flex items-center justify-between p-3 rounded-2xl border transition-all",
                  uid === user.uid ? "bg-indigo-600/10 border-indigo-500/30" : "bg-white/5 border-transparent",
                  !player.isOnline && "opacity-50 grayscale"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center font-bold text-lg">
                      {player.name[0].toUpperCase()}
                    </div>
                    {room.hostId === uid && (
                      <div className="absolute -top-2 -right-2 bg-yellow-400 text-slate-950 p-1 rounded-full shadow-lg">
                        <Crown className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="font-bold text-sm leading-none mb-1">{player.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{player.points} نقطة</p>
                  </div>
                </div>
                
                {isHost && uid !== user.uid && (
                  <button 
                    onClick={() => onKick(uid)}
                    className="p-2 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <button 
            onClick={onLeave}
            className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-2xl transition-all font-bold"
          >
            <LogOut className="w-5 h-5" />
            خروج من الغرفة
          </button>

          {isHost && room.status !== 'lobby' && (
            <button 
              onClick={() => safeUpdateDoc(doc(db, 'rooms', roomId), { status: 'lobby', currentMeme: deleteField(), memeOptions: deleteField(), captions: {}, votes: {}, revealIndex: 0 })}
              className="w-full flex items-center justify-center gap-2 p-3 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-2xl transition-all font-bold"
            >
              <RefreshCw className="w-5 h-5" />
              إلغاء الجولة
            </button>
          )}
        </div>

        {isHost && room.status === 'lobby' && (
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="font-bold text-sm text-slate-400 uppercase tracking-wider">إعدادات الغرفة</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">نقاط الفوز</label>
                <input 
                  type="number" 
                  value={room.settings.maxPoints}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val)) {
                      safeUpdateDoc(doc(db, 'rooms', roomId), { 'settings.maxPoints': val });
                    }
                  }}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">وقت الجولة (ثواني)</label>
                <input 
                  type="number" 
                  value={room.settings.roundTime}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val)) {
                      safeUpdateDoc(doc(db, 'rooms', roomId), { 'settings.roundTime': val });
                    }
                  }}
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Game Area */}
      <div className="lg:col-span-3 space-y-6 order-1 lg:order-2">
        <AnimatePresence mode="wait">
          {room.status === 'lobby' && (
            <motion.div 
              key="lobby"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="h-full flex flex-col items-center justify-center bg-white/5 backdrop-blur-xl border border-white/10 rounded-[40px] p-12 text-center space-y-8"
            >
              <div className="w-24 h-24 bg-indigo-600/20 rounded-full flex items-center justify-center animate-pulse">
                <Users className="w-12 h-12 text-indigo-400" />
              </div>
              <div className="space-y-2">
                <h2 className="text-4xl font-black">في انتظار اللاعبين...</h2>
                <p className="text-slate-400">شارك الكود <span className="text-white font-mono font-bold bg-white/10 px-2 py-1 rounded">{roomId}</span> مع أصدقائك</p>
              </div>
              {isHost ? (
                <button 
                  onClick={onStart}
                  className="bg-indigo-600 hover:bg-indigo-500 px-12 py-4 rounded-2xl font-black text-xl flex items-center gap-3 transition-all shadow-xl shadow-indigo-600/30"
                >
                  <Play className="w-6 h-6 fill-current" />
                  ابدأ المعركة
                </button>
              ) : (
                <p className="text-indigo-400 animate-bounce font-bold">بانتظار الهوست لبدء اللعبة...</p>
              )}
            </motion.div>
          )}

          {room.status === 'selecting' && (
            <motion.div 
              key="selecting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-black">اختر الميم للجولة القادمة</h2>
                <p className="text-slate-400">
                  {isHost ? 'اختر أفضل صورة لبدء الجولة' : 'الهوست يقوم باختيار الميم الآن...'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {room.memeOptions?.map((meme, idx) => (
                  <motion.div 
                    key={idx}
                    whileHover={isHost ? { scale: 1.05 } : {}}
                    className={cn(
                      "relative aspect-[3/4] rounded-3xl overflow-hidden border-2 transition-all bg-slate-900 group",
                      isHost ? "cursor-pointer border-white/10 hover:border-indigo-500" : "border-transparent"
                    )}
                    onClick={() => isHost && onSelectMeme(meme)}
                  >
                    <img 
                      src={meme.url} 
                      alt="Option" 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    {isHost && (
                      <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/20 flex items-center justify-center transition-all">
                        <Play className="w-12 h-12 text-white opacity-0 group-hover:opacity-100 transition-all" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>

              {isHost && (
                <div className="space-y-8">
                  <div className="flex justify-center">
                    <button 
                      onClick={onNext}
                      className="bg-white/10 hover:bg-white/20 px-8 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all"
                    >
                      تبديل الخيارات
                    </button>
                  </div>
                  
                  <CustomImageSelector onSelectMeme={onSelectMeme} />
                </div>
              )}
            </motion.div>
          )}

          {room.status === 'writing' && (
            <motion.div 
              key="writing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">اكتب تعليقك المضحك!</h2>
                <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full font-mono font-bold">
                  <Clock className="w-5 h-5 text-indigo-400" />
                  {timeLeft}s
                </div>
              </div>
              
              <div className="relative aspect-video rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-slate-900 flex items-center justify-center">
                <img 
                  src={room.currentMeme?.url} 
                  alt="Meme" 
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://i.imgflip.com/1otk96.jpg'; // Fallback image
                  }}
                  referrerPolicy="no-referrer"
                />
              </div>

              <div className="flex gap-4">
                <input 
                  type="text" 
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="اكتب شيئاً مضحكاً..."
                  className="flex-grow bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <button 
                  onClick={() => {
                    onSubmitCaption(caption);
                    setCaption('');
                  }}
                  disabled={!caption.trim() || !!room.captions?.[user.uid]}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-8 rounded-2xl transition-all flex items-center gap-2 font-bold"
                >
                  {room.captions?.[user.uid] ? 'تم الإرسال' : <><Send className="w-5 h-5" /> إرسال</>}
                </button>
              </div>
            </motion.div>
          )}

          {room.status === 'revealing' && (
            <motion.div 
              key="revealing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-black">استعرض التعليقات</h2>
                <p className="text-slate-400">من صاحب أذكى تعليق؟</p>
              </div>

              <div className="relative aspect-video rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-slate-900 flex items-center justify-center">
                <img 
                  src={room.currentMeme?.url} 
                  alt="Meme" 
                  className="max-w-full max-h-full object-contain opacity-50"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://i.imgflip.com/1otk96.jpg'; // Fallback image
                  }}
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 flex items-center justify-center p-12">
                  <motion.div 
                    key={room.revealIndex}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-white text-slate-950 p-8 rounded-3xl shadow-2xl text-center max-w-2xl"
                  >
                    <p className="text-4xl font-black leading-tight">
                      {Object.values(room.captions || {})[room.revealIndex || 0]}
                    </p>
                  </motion.div>
                </div>
              </div>

              {isHost && (
                <div className="flex justify-center">
                  <button 
                    onClick={onAdvanceReveal}
                    className="bg-white text-slate-950 px-12 py-4 rounded-2xl font-black text-xl flex items-center gap-3 hover:scale-105 transition-all"
                  >
                    التالي
                    <ChevronRight className="w-6 h-6" />
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {room.status === 'voting' && (
            <motion.div 
              key="voting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-black">وقت التصويت!</h2>
                <p className="text-slate-400">اختر أضحك تعليق (لا يمكنك التصويت لنفسك)</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(room.captions || {}).map(([uid, text]) => (
                  <button 
                    key={uid}
                    onClick={() => onVote(uid)}
                    disabled={uid === user.uid || !!room.votes?.[user.uid]}
                    className={cn(
                      "p-6 rounded-3xl border-2 text-right transition-all group relative overflow-hidden",
                      room.votes?.[user.uid] === uid 
                        ? "bg-indigo-600 border-indigo-400" 
                        : "bg-white/5 border-white/10 hover:border-indigo-500/50",
                      uid === user.uid && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <p className="text-xl font-bold relative z-10">{text}</p>
                    {room.votes?.[user.uid] === uid && (
                      <div className="absolute top-2 left-2">
                        <Trophy className="w-6 h-6 text-yellow-400" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {isHost && (
                <div className="flex justify-center">
                  <button 
                    onClick={onCalculateResults}
                    className="bg-indigo-600 hover:bg-indigo-500 px-12 py-4 rounded-2xl font-black text-xl shadow-xl shadow-indigo-600/30"
                  >
                    إظهار النتائج
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {room.status === 'results' && (
            <motion.div 
              key="results"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="h-full flex flex-col items-center justify-center space-y-8"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-yellow-400 blur-[60px] opacity-20 animate-pulse" />
                <Trophy className="w-32 h-32 text-yellow-400 relative z-10" />
              </div>
              
              <div className="text-center space-y-4">
                <h2 className="text-5xl font-black">نتائج الجولة</h2>
                <div className="space-y-2">
                  {Object.entries(room.players)
                    .sort((a, b) => b[1].points - a[1].points)
                    .map(([uid, p]) => (
                      <div key={uid} className="flex items-center gap-4 text-2xl">
                        <span className="text-slate-400 font-mono">{p.points}</span>
                        <span className="font-bold">{p.name}</span>
                      </div>
                    ))
                  }
                </div>
              </div>

              {isHost && (
                <button 
                  onClick={onNext}
                  className="bg-white text-slate-950 px-12 py-4 rounded-2xl font-black text-xl hover:scale-105 transition-all"
                >
                  الجولة التالية
                </button>
              )}
            </motion.div>
          )}

          {room.status === 'winner' && (
            <motion.div 
              key="winner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex flex-col items-center justify-center space-y-8 text-center"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-indigo-500 blur-[100px] opacity-30" />
                <Crown className="w-48 h-48 text-yellow-400 relative z-10 animate-bounce" />
              </div>
              
              <div className="space-y-4">
                <h2 className="text-7xl font-black tracking-tighter">الفائز النهائي!</h2>
                <p className="text-4xl font-bold text-indigo-400">
                  {room.winner && room.players[room.winner]?.name}
                </p>
              </div>

              {isHost && (
                <button 
                  onClick={() => safeUpdateDoc(doc(db, 'rooms', roomId), { 
                    status: 'lobby', 
                    winner: deleteField(), 
                    'players': Object.fromEntries(Object.entries(room.players).map(([uid, p]) => [uid, { ...p, points: 0 }])) 
                  })}
                  className="bg-white text-slate-950 px-12 py-4 rounded-2xl font-black text-xl"
                >
                  العودة للوبي
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
