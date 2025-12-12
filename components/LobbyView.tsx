
import React, { useState, useEffect } from 'react';
import { GLOSSARY_DATA, GAME_MODES, ADMIN_UIDS } from '../constants';
import { GameMode, FactionType, ServerRegion } from '../types';
import { TankGallery } from './TankGallery';
import { BossGallery } from './BossGallery';
import { LegalModal } from './LegalModal';
import { PrivacyModal } from './PrivacyModal';
import { Settings, Book, Database, Sword, Crown, Play, Cpu, LogIn, LogOut, User, Ghost } from 'lucide-react';

// FIREBASE IMPORTS
import { auth, googleProvider } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, User as FirebaseUser } from 'firebase/auth';

interface LobbyViewProps {
  onStart: (name: string, mode: GameMode, faction: FactionType, selectedClass: string, region: ServerRegion) => void;
  onOpenSettings: () => void;
  onOpenStudio?: () => void;
}

// --- SERVER DATA (Hidden from UI, used for default) ---
const LOCAL_REGION: ServerRegion = { id: 'local', name: 'Local Sandbox', flag: '🏠', ping: 0, occupancy: 10, url: 'local', type: 'LOCAL' };

export const LobbyView: React.FC<LobbyViewProps> = ({ onStart, onOpenSettings, onOpenStudio }) => {
  const [name, setName] = useState('');
  const [selectedMode, setSelectedMode] = useState<GameMode>('FFA');
  const [isHoveringPlay, setIsHoveringPlay] = useState(false);
  
  // Auth State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Modal States
  const [showGlossary, setShowGlossary] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showBossGallery, setShowBossGallery] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Intro Animation
  const [mounted, setMounted] = useState(false);
  
  // Load saved data and Auth Listener
  useEffect(() => { 
      setMounted(true); 
      
      // Check local storage first
      const savedName = localStorage.getItem('tank_io_nickname');
      if (savedName) setName(savedName);

      // Listen for Firebase Auth State
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
          setUser(currentUser);
          setAuthLoading(false);
          if (currentUser && currentUser.displayName) {
              // Auto-fill name from Google Account
              setName(currentUser.displayName);
          } else if (currentUser && currentUser.isAnonymous && !name) {
              setName(`Guest_${currentUser.uid.slice(0, 4)}`);
          }
      });

      return () => unsubscribe();
  }, []);

  const handleStart = () => {
      localStorage.setItem('tank_io_nickname', name);
      // Always pass LOCAL_REGION since UI is removed
      onStart(name || 'Player', selectedMode, FactionType.NONE, 'basic', LOCAL_REGION);
  };

  const handleLogin = async () => {
      try {
          await signInWithPopup(auth, googleProvider);
      } catch (error: any) {
          console.error("Login failed", error);
          if (error.code === 'auth/unauthorized-domain') {
              alert(`Login Failed: Unauthorized Domain (${window.location.hostname}).\n\nTo fix this, go to Firebase Console -> Authentication -> Settings -> Authorized Domains and add "${window.location.hostname}" to the list.`);
          } else if (error.code !== 'auth/popup-closed-by-user') {
              alert(`Login failed: ${error.message}`);
          }
      }
  };

  const handleGuestLogin = async () => {
      try {
          await signInAnonymously(auth);
      } catch (error: any) {
          console.error("Guest login failed", error);
          alert(`Guest login failed: ${error.message}`);
      }
  };

  const handleLogout = async () => {
      try {
          await signOut(auth);
          setName(''); // Clear name on logout
      } catch (error) {
          console.error("Logout failed", error);
      }
  };

  const currentModeConfig = GAME_MODES.find(m => m.id === selectedMode);
  
  // Check Admin
  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  return (
    <div className="fixed inset-0 bg-[#050505] flex items-center justify-center overflow-hidden font-sans select-none text-slate-200">
      
      {/* --- LAYER 0: DYNAMIC BACKGROUND --- */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Animated Grid Floor */}
          <div className="absolute inset-0 opacity-20" 
               style={{ 
                   backgroundImage: `linear-gradient(to right, #333 1px, transparent 1px), linear-gradient(to bottom, #333 1px, transparent 1px)`,
                   backgroundSize: '40px 40px',
                   transform: 'perspective(500px) rotateX(60deg) translateY(100px) scale(2)',
                   animation: 'gridMove 20s linear infinite',
                   maskImage: 'linear-gradient(to bottom, transparent, black)'
               }}>
          </div>
          
          {/* Ambient Glows */}
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 blur-[150px] rounded-full animate-pulse"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 blur-[150px] rounded-full animate-pulse" style={{ animationDelay: '2s' }}></div>
          
          {/* Floating Particles (CSS Only) */}
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-30 animate-spin-slow"></div>
      </div>

      <style>{`
        @keyframes gridMove { 0% { background-position: 0 0; } 100% { background-position: 0 40px; } }
        @keyframes spinSlow { 0% { transform: scale(1.5) rotate(0deg); } 100% { transform: scale(1.5) rotate(360deg); } }
        .animate-spin-slow { animation: spinSlow 200s linear infinite; }
        .glass-panel { background: rgba(10, 10, 20, 0.6); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
        .neon-text { text-shadow: 0 0 10px currentColor; }
        .clip-diagonal { clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
      `}</style>

      {/* --- MAIN CONTAINER --- */}
      <div className={`relative z-10 w-full max-w-7xl h-full md:h-[90vh] flex flex-col md:flex-row gap-6 p-4 md:p-8 transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
        
        {/* --- LEFT COLUMN: IDENTITY & VISUALS --- */}
        <div className="flex-1 flex flex-col justify-center items-center md:items-start space-y-8 relative">
            
            {/* Logo Area */}
            <div className="relative group cursor-default text-center md:text-left">
                <h1 className="text-6xl md:text-9xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-cyan-200 to-cyan-500 drop-shadow-[0_0_30px_rgba(34,211,238,0.3)] transition-all duration-300 group-hover:drop-shadow-[0_0_50px_rgba(34,211,238,0.6)]">
                    TANK.IO
                </h1>
                <div className="absolute -bottom-2 md:-right-4 right-0 bg-white/10 px-3 py-1 rounded text-[10px] font-bold tracking-[0.5em] text-cyan-400 border border-cyan-500/30 backdrop-blur-md uppercase">
                    Project Next Gen
                </div>
            </div>

            {/* Mode Description Hologram */}
            <div className="hidden md:block w-full max-w-md p-6 glass-panel rounded-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-50"></div>
                
                <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-2">Selected Protocol</h3>
                <div className="text-4xl font-black text-white mb-2 neon-text" style={{ color: currentModeConfig?.color }}>
                    {currentModeConfig?.name}
                </div>
                <p className="text-sm text-slate-400 font-medium leading-relaxed border-l-2 border-slate-700 pl-3">
                    {currentModeConfig?.description}
                </p>

                {/* Animated Decor */}
                <div className="absolute bottom-4 right-4 flex gap-1 opacity-50">
                    {[1,2,3].map(i => <div key={i} className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse" style={{ animationDelay: `${i*0.2}s` }}></div>)}
                </div>
            </div>

            {/* Footer Links (Desktop) */}
            <div className="hidden md:flex gap-6 text-xs font-bold text-slate-500 tracking-wider mt-auto">
                <button onClick={() => setShowPrivacy(true)} className="hover:text-cyan-400 transition-colors">PRIVACY_POLICY</button>
                <button onClick={() => setShowLegal(true)} className="hover:text-cyan-400 transition-colors">TERMS_OF_SERVICE</button>
                <span className="opacity-30">|</span>
                <span className="opacity-50">v4.0.0 STABLE</span>
            </div>
        </div>

        {/* --- RIGHT COLUMN: COMMAND DECK --- */}
        <div className="w-full md:w-[480px] glass-panel rounded-3xl p-6 md:p-8 flex flex-col gap-6 shadow-2xl relative overflow-hidden shrink-0">
            {/* Decorative Scanline */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-0 pointer-events-none bg-[length:100%_4px,6px_100%] opacity-20"></div>

            {/* Authentication Section */}
            <div className="relative z-10 flex justify-end">
                {!authLoading && (
                    user ? (
                        <div className="flex items-center gap-3 bg-slate-900/60 p-2 pl-4 rounded-full border border-green-500/30">
                            <div className="flex flex-col items-end">
                                <span className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">Pilot</span>
                                <span className="text-xs font-bold text-green-400">{user.displayName || "Unknown"}</span>
                            </div>
                            {user.photoURL ? (
                                <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-green-500" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-green-900 flex items-center justify-center text-green-400">
                                    {user.isAnonymous ? <Ghost size={16}/> : <User size={16}/>}
                                </div>
                            )}
                            <button 
                                onClick={handleLogout}
                                className="w-8 h-8 flex items-center justify-center bg-red-900/20 hover:bg-red-900/50 rounded-full text-red-400 transition-colors ml-1"
                                title="Sign Out"
                            >
                                <LogOut size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button 
                                onClick={handleLogin}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 px-4 rounded-full transition-all border border-slate-600 hover:border-white shadow-lg"
                            >
                                <LogIn size={14} />
                                <span>GOOGLE</span>
                            </button>
                            <button 
                                onClick={handleGuestLogin}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold py-2 px-4 rounded-full transition-all border border-slate-600 hover:border-white shadow-lg"
                            >
                                <Ghost size={14} />
                                <span>GUEST</span>
                            </button>
                        </div>
                    )
                )}
            </div>

            {/* Input Section */}
            <div className="relative z-10 space-y-2 mt-2">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest ml-1">Identity</label>
                <div className="relative group">
                    <input
                        type="text"
                        placeholder="ENTER CALLSIGN"
                        className="w-full bg-slate-900/50 text-white border-2 border-slate-700 rounded-xl px-5 py-4 text-center font-bold text-lg outline-none focus:border-cyan-500 focus:bg-slate-900/80 transition-all placeholder:text-slate-600 uppercase tracking-wider shadow-inner"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={15}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-cyan-500 transition-colors">
                        <Cpu size={20} />
                    </div>
                </div>
            </div>

            {/* Game Mode Grid */}
            <div className="relative z-10 space-y-2">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest ml-1">Deployment Zone</label>
                <div className="grid grid-cols-2 gap-2">
                    {GAME_MODES.map(mode => {
                        const isSelected = selectedMode === mode.id;
                        return (
                            <button
                                key={mode.id}
                                onClick={() => setSelectedMode(mode.id)}
                                className={`
                                    relative px-4 py-3 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-center gap-1 group overflow-hidden
                                    ${isSelected 
                                        ? 'bg-slate-800 border-white text-white shadow-[0_0_20px_rgba(255,255,255,0.1)]' 
                                        : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:border-slate-600 hover:bg-slate-800/60'}
                                `}
                                style={{ borderColor: isSelected ? mode.color : undefined }}
                            >
                                {isSelected && (
                                    <div className="absolute inset-0 opacity-10 animate-pulse" style={{ backgroundColor: mode.color }}></div>
                                )}
                                <span className={`text-xs font-black uppercase tracking-wider ${isSelected ? 'neon-text' : ''}`}>{mode.name}</span>
                                {isSelected && <div className="w-1.5 h-1.5 rounded-full mt-1" style={{ backgroundColor: mode.color, boxShadow: `0 0 10px ${mode.color}` }} />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Launch Button */}
            <div className="relative z-10 mt-2">
                <button
                    onClick={handleStart}
                    onMouseEnter={() => setIsHoveringPlay(true)}
                    onMouseLeave={() => setIsHoveringPlay(false)}
                    className="w-full relative group overflow-hidden bg-white text-black font-black text-2xl py-5 rounded-xl clip-diagonal shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all hover:scale-[1.02] hover:shadow-[0_0_50px_rgba(34,211,238,0.5)] active:scale-[0.98]"
                >
                    <div className={`absolute inset-0 bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>
                    <span className="relative z-10 flex items-center justify-center gap-3 group-hover:text-white transition-colors">
                        <Play fill="currentColor" size={24} />
                        START GAME
                    </span>
                    
                    {/* Running Light Effect */}
                    <div className="absolute bottom-0 left-0 w-full h-1 bg-black/10">
                        <div className="h-full w-1/3 bg-black/20 animate-[loading_2s_ease-in-out_infinite]"></div>
                    </div>
                </button>
            </div>

            {/* Tool Grid */}
            <div className="relative z-10 grid grid-cols-4 gap-2 mt-auto pt-4 border-t border-slate-800">
                <NavBtn icon={<Settings size={18} />} label="System" onClick={onOpenSettings} />
                <NavBtn icon={<Book size={18} />} label="Glossary" onClick={() => setShowGlossary(true)} />
                <NavBtn icon={<Database size={18} />} label="Armory" onClick={() => setShowGallery(true)} />
                <NavBtn icon={<Sword size={18} />} label="Bestiary" onClick={() => setShowBossGallery(true)} highlight />
                
                {/* Developer Access (ADMIN ONLY) */}
                {isAdmin && (
                    <button 
                        onClick={onOpenStudio} 
                        className="col-span-4 flex items-center justify-center gap-2 py-2 mt-2 rounded border border-dashed border-slate-700 text-[10px] text-slate-500 font-bold hover:text-cyan-400 hover:border-cyan-500/50 transition-colors uppercase tracking-widest group bg-slate-900/50"
                    >
                        <Crown size={12} className="group-hover:text-yellow-400 transition-colors" />
                        Developer Studio (Admin)
                    </button>
                )}
            </div>
            
            {/* Mobile Footer */}
            <div className="md:hidden flex justify-center gap-4 text-[10px] font-bold text-slate-600">
                <button onClick={() => setShowPrivacy(true)}>Privacy</button> • <button onClick={() => setShowLegal(true)}>Terms</button>
            </div>
        </div>

      </div>

      {/* --- FULL SCREEN MODALS --- */}
      {showGlossary && <ModalWrapper onClose={() => setShowGlossary(false)} title="TACTICAL GUIDE"><GlossaryContent /></ModalWrapper>}
      {showGallery && <TankGallery onClose={() => setShowGallery(false)} />}
      {showBossGallery && <BossGallery onClose={() => setShowBossGallery(false)} />}
      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </div>
  );
};

// --- SUB COMPONENTS ---

const NavBtn: React.FC<{ icon: React.ReactNode, label: string, onClick?: () => void, highlight?: boolean }> = ({ icon, label, onClick, highlight }) => (
    <button 
        onClick={onClick}
        className={`
            flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border transition-all active:scale-95 group relative overflow-hidden
            ${highlight 
                ? 'bg-red-900/20 border-red-500/30 text-red-400 hover:bg-red-900/40 hover:border-red-500' 
                : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white hover:border-cyan-500/50'}
        `}
    >
        <div className="relative z-10 transition-transform group-hover:scale-110 duration-300">{icon}</div>
        <span className="relative z-10 text-[9px] font-black uppercase tracking-wide">{label}</span>
        {highlight && <div className="absolute inset-0 bg-red-500/5 animate-pulse"></div>}
    </button>
);

const ModalWrapper: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({ onClose, title, children }) => (
    <div className="absolute inset-0 bg-slate-950 z-[100] flex flex-col animate-fade-in">
        <div className="p-4 border-b border-slate-800 bg-black/50 flex justify-between items-center shrink-0 backdrop-blur-md">
            <h2 className="text-xl font-black italic text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 uppercase tracking-tighter">{title}</h2>
            <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-slate-900 rounded-full text-slate-400 border border-slate-700 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-900/50">
            {children}
        </div>
    </div>
);

const GlossaryContent = () => (
    <div className="grid gap-3 pb-8 max-w-2xl mx-auto">
        {GLOSSARY_DATA.map((item, idx) => (
            <div key={idx} className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 hover:border-cyan-500/30 transition-colors group">
                <span className="text-[9px] font-black uppercase text-cyan-600 mb-1 block tracking-widest">{item.category}</span>
                <h3 className="text-white font-bold text-sm mb-2 group-hover:text-cyan-400 transition-colors">{item.term}</h3>
                <p className="text-slate-400 text-xs leading-relaxed">{item.definition}</p>
            </div>
        ))}
    </div>
);
