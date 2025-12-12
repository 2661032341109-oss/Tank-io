import React, { useState } from 'react';
import { LegalModal } from './LegalModal';
import { PrivacyModal } from './PrivacyModal';

interface MainMenuProps {
  onEnterLobby: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({ onEnterLobby }) => {
  const [showLegal, setShowLegal] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  return (
    <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center overflow-hidden animate-fade-in">
      {/* Background elements from LobbyView for consistency */}
      <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-950"></div>

      <div className="relative z-10 flex flex-col items-center justify-center text-center p-8">
        <div className="animate-fade-in-down">
          <h1 className="text-8xl md:text-9xl font-black italic text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 drop-shadow-[0_0_15px_rgba(0,204,255,0.4)]">
            TANK.IO
          </h1>
          <p className="text-slate-400 tracking-[0.5em] text-sm md:text-base uppercase mt-2 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            Next Gen + Mega Expansion
          </p>
        </div>

        <button
          onClick={onEnterLobby}
          className="mt-20 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-5 px-16 rounded-xl text-2xl shadow-lg shadow-cyan-900/50 transition-all transform hover:scale-105 active:scale-100 animate-fade-in relative overflow-hidden"
          style={{ animationDelay: '0.6s' }}
        >
          <span className="absolute inset-0 bg-white/10 animate-pulse"></span>
          <span className="relative">ENTER HANGAR</span>
        </button>
      </div>

      <div className="absolute bottom-6 left-6 right-6 z-10 flex justify-between text-xs text-slate-500 font-bold animate-fade-in" style={{ animationDelay: '0.9s' }}>
        <button onClick={() => setShowPrivacy(true)} className="hover:text-white transition-colors">
          PRIVACY POLICY
        </button>
        <button onClick={() => setShowLegal(true)} className="hover:text-white transition-colors">
          TERMS OF SERVICE
        </button>
      </div>

      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </div>
  );
};
