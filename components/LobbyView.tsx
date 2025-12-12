
import React, { useState, useEffect } from 'react';
import { GLOSSARY_DATA, GAME_MODES, ADMIN_UIDS } from '../constants';
import { GameMode, FactionType, ServerRegion } from '../types';
import { TankGallery } from './TankGallery';
import { BossGallery } from './BossGallery';
import { LegalModal } from './LegalModal';
import { PrivacyModal } from './PrivacyModal';
import { Settings, Book, Database, Sword, Crown, Play, LogIn, LogOut, User, Ghost, Share2, Users } from 'lucide-react';

// FIREBASE IMPORTS
import { auth, googleProvider, db } from '../firebase';
import firebase from 'firebase/compat/app';

interface LobbyViewProps {
  onStart: (name: string, mode: GameMode, faction: FactionType, selectedClass: string, region: ServerRegion) => void;
  onOpenSettings: () => void;
  onOpenStudio?: () => void;
}

const DEFAULT_REGION: ServerRegion = { 
    id: 'asia-se1', 
    name: 'Asia Southeast', 
    flag: '🌏', 
    ping: 0, 
    occupancy: 0, 
    url: 'public', 
    type: 'OFFICIAL' 
};

export const LobbyView: React.FC<LobbyViewProps> = ({ onStart, onOpenSettings, onOpenStudio }) => {
  const [name, setName] = useState('');
  const [selectedMode, setSelectedMode] = useState<GameMode>('FFA');
  
  // Realtime Data
  const [modeCounts, setModeCounts] = useState<Record<string, number>>({});
  const [totalOnline, setTotalOnline] = useState<number>(0);

  // Auth State
  const [user, setUser] = useState<firebase.User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Modal States
  const [showGlossary, setShowGlossary] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showBossGallery, setShowBossGallery] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => { 
      const savedName = localStorage.getItem('tank_io_nickname');
      if (savedName) setName(savedName);

      const unsubscribeAuth = auth.onAuthStateChanged((currentUser) => {
          setUser(currentUser);
          setAuthLoading(false);
          if (currentUser && currentUser.displayName) {
              setName(currentUser.displayName);
          } else if (currentUser && currentUser.isAnonymous && !name) {
              setName(`Guest_${currentUser.uid.slice(0, 4)}`);
          }
      });

      return () => unsubscribeAuth();
  }, []);

  // --- GLOBAL PLAYER COUNTER SYSTEM ---
  useEffect(() => {
      const listeners: (() => void)[] = [];

      GAME_MODES.forEach(mode => {
          if (mode.id === 'SANDBOX') {
              setModeCounts(prev => ({ ...prev, [mode.id]: 0 }));
              return;
          }

          const playersRef = db.ref(`rooms/${mode.id}/players`);
          const cb = playersRef.on('value', (snapshot) => {
              const count = snapshot ? snapshot.numChildren() : 0;
              setModeCounts(prev => {
                  const newState = { ...prev, [mode.id]: count };
                  const total = Object.values(newState).reduce((a: number, b: number) => a + b, 0);
                  setTotalOnline(total);
                  return newState;
              });
          });
          listeners.push(() => playersRef.off('value', cb));
      });

      return () => {
          listeners.forEach(unsub => unsub());
      };
  }, []);

  const handleStart = () => {
      if (!name.trim()) {
          alert("Please enter a name!");
          return;
      }
      localStorage.setItem('tank_io_nickname', name);
      const regionData = { ...DEFAULT_REGION, occupancy: modeCounts[selectedMode] || 0 };
      onStart(name || 'Player', selectedMode, FactionType.NONE, 'basic', regionData);
  };

  const handleLogin = async () => {
      try { await auth.signInWithPopup(googleProvider); } catch (error: any) { console.error(error); }
  };

  const handleGuestLogin = async () => {
      try { await auth.signInAnonymously(); } catch (error: any) { alert(error.message); }
  };

  const handleLogout = async () => {
      try { await auth.signOut(); setName(''); } catch (error) {}
  };

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  return (
    <div className="fixed inset-0 bg-[#1a1a1a] flex items-center justify-center overflow-hidden font-sans select-none text-slate-200">
      
      {/* Background */}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 opacity-90"></div>

      {/* --- MAIN CONTAINER --- */}
      <div className="relative z-10 w-full max-w-5xl h-full md:h-auto flex flex-col md:flex-row gap-6 p-6">
        
        {/* LEFT: Branding & Status */}
        <div className="flex-1 flex flex-col justify-center items-center md:items-start space-y-6">
            <div>
                <h1 className="text-6xl md:text-8xl font-black italic tracking-tighter text-white drop-shadow-xl">
                    DIEP<span className="text-cyan-400">.IO</span>
                </h1>
                <div className="flex items-center gap-2 mt-2">
                    <span className="bg-green-500 text-black text-xs font-bold px-2 py-0.5 rounded">ONLINE</span>
                    <span className="text-slate-400 text-sm font-bold">{totalOnline} Players</span>
                </div>
            </div>

            <div className="hidden md:block text-slate-400 text-sm max-w-sm leading-relaxed">
                Build your tank, evolve your stats, and dominate the arena. 
                Select a game mode to begin.
            </div>
        </div>

        {/* RIGHT: Controls */}
        <div className="w-full md:w-[450px] bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-700 p-6 flex flex-col gap-5 shadow-2xl">
            
            {/* 1. Identity */}
            <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-500 uppercase">Nickname</label>
                    {!authLoading && (
                        user ? (
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-green-400">{user.displayName || "Guest"}</span>
                                <button onClick={handleLogout} className="text-red-400 hover:text-white"><LogOut size={14}/></button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <button onClick={handleLogin} className="text-cyan-400 text-xs font-bold hover:underline">Login</button>
                                <button onClick={handleGuestLogin} className="text-slate-400 text-xs font-bold hover:underline">Guest</button>
                            </div>
                        )
                    )}
                </div>
                <input
                    type="text"
                    placeholder="Name..."
                    className="w-full bg-slate-800 text-white border-2 border-slate-700 rounded-lg px-4 py-3 font-bold text-lg outline-none focus:border-cyan-500 transition-all text-center"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={15}
                />
            </div>

            {/* 2. Game Mode Grid (Simple) */}
            <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Select Mode</label>
                <div className="grid grid-cols-2 gap-2">
                    {GAME_MODES.map(mode => (
                        <button
                            key={mode.id}
                            onClick={() => setSelectedMode(mode.id)}
                            className={`
                                relative p-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1
                                ${selectedMode === mode.id 
                                    ? 'bg-slate-800 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]' 
                                    : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'}
                            `}
                        >
                            <span className="font-black uppercase text-sm tracking-wider">{mode.name}</span>
                            {modeCounts[mode.id] > 0 && (
                                <span className="text-[10px] font-bold bg-black/40 px-2 rounded-full text-slate-300">
                                    {modeCounts[mode.id]} Players
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* 3. Play Button */}
            <button
                onClick={handleStart}
                className="w-full bg-green-600 hover:bg-green-500 text-white font-black text-xl py-4 rounded-xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] border-b-4 border-green-800 flex items-center justify-center gap-2"
            >
                <Play fill="currentColor" size={24} /> PLAY
            </button>

            {/* 4. Footer Links */}
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-800">
                <IconButton icon={<Settings size={18}/>} label="Settings" onClick={onOpenSettings} />
                <IconButton icon={<Book size={18}/>} label="Guide" onClick={() => setShowGlossary(true)} />
                <IconButton icon={<Database size={18}/>} label="Tanks" onClick={() => setShowGallery(true)} />
                <IconButton icon={<Sword size={18}/>} label="Bosses" onClick={() => setShowBossGallery(true)} />
            </div>
            
            {isAdmin && (
                <button onClick={onOpenStudio} className="w-full py-2 text-xs font-bold text-yellow-500 border border-dashed border-yellow-600/50 rounded hover:bg-yellow-900/20">
                    Developer Studio
                </button>
            )}
        </div>
      </div>

      {/* Modals */}
      {showGlossary && <ModalWrapper onClose={() => setShowGlossary(false)} title="Game Guide"><GlossaryContent /></ModalWrapper>}
      {showGallery && <TankGallery onClose={() => setShowGallery(false)} />}
      {showBossGallery && <BossGallery onClose={() => setShowBossGallery(false)} />}
      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
      
      {/* Footer Legal */}
      <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
          <div className="pointer-events-auto inline-flex gap-4 text-[10px] text-slate-600 font-bold uppercase">
              <button onClick={() => setShowLegal(true)} className="hover:text-slate-400">Terms</button>
              <button onClick={() => setShowPrivacy(true)} className="hover:text-slate-400">Privacy</button>
          </div>
      </div>
    </div>
  );
};

const IconButton: React.FC<{ icon: React.ReactNode, label: string, onClick?: () => void }> = ({ icon, label, onClick }) => (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg bg-slate-900/50 hover:bg-slate-800 text-slate-500 hover:text-white transition-colors">
        {icon}
        <span className="text-[9px] font-bold uppercase">{label}</span>
    </button>
);

const ModalWrapper: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({ onClose, title, children }) => (
    <div className="absolute inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
        <div className="bg-slate-900 w-full max-w-2xl max-h-[80vh] rounded-2xl border border-slate-700 flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                <h2 className="text-xl font-bold text-white uppercase">{title}</h2>
                <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">{children}</div>
        </div>
    </div>
);

const GlossaryContent = () => (
    <div className="grid gap-3">
        {GLOSSARY_DATA.map((item, idx) => (
            <div key={idx} className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[10px] font-bold text-cyan-600 uppercase mb-1">{item.category}</div>
                <div className="font-bold text-white text-sm">{item.term}</div>
                <div className="text-slate-400 text-xs mt-1">{item.definition}</div>
            </div>
        ))}
    </div>
);
