
import React, { useEffect, useState } from 'react';

interface LoadingScreenProps {
    serverName: string;
    onComplete: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ serverName, onComplete }) => {
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState<string[]>([]);

    useEffect(() => {
        const steps = [
            "Initializing handshake protocol...",
            "Encrypting connection (TLS 1.3)...",
            `Resolving host: ${serverName}...`,
            "Packets exchange: [SYN] -> [SYN, ACK]...",
            "Loading assets: geometry_buffer.bin...",
            "Loading assets: textures_atlas_4k.png...",
            "Synchronizing world state...",
            "Connection established."
        ];

        let currentStep = 0;
        
        const interval = setInterval(() => {
            if (currentStep < steps.length) {
                setLogs(prev => [...prev, steps[currentStep]]);
                currentStep++;
            }
            
            setProgress(prev => {
                const next = prev + (Math.random() * 15);
                return next > 100 ? 100 : next;
            });

        }, 250);

        const timeout = setTimeout(() => {
            setProgress(100);
            setTimeout(onComplete, 500); // Small delay at 100%
        }, 2500);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [onComplete, serverName]);

    return (
        <div className="absolute inset-0 bg-black z-[100] flex flex-col items-center justify-center font-mono text-cyan-500 overflow-hidden">
            {/* Grid Background */}
            <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(0,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.1)_1px,transparent_1px)] bg-[size:20px_20px]"></div>
            
            <div className="relative z-10 w-full max-w-md p-8 space-y-6">
                
                {/* Loader Ring */}
                <div className="flex justify-center">
                    <div className="relative w-24 h-24">
                        <div className="absolute inset-0 border-4 border-cyan-900 rounded-full"></div>
                        <div className="absolute inset-0 border-t-4 border-cyan-400 rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center font-bold text-xl text-white">
                            {Math.floor(progress)}%
                        </div>
                    </div>
                </div>

                <div className="text-center">
                    <h2 className="text-2xl font-black text-white tracking-widest uppercase animate-pulse">CONNECTING</h2>
                    <p className="text-xs text-cyan-700 mt-1 uppercase tracking-widest">{serverName}</p>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                    <div 
                        className="h-full bg-cyan-500 shadow-[0_0_10px_#06b6d4] transition-all duration-100 ease-out"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>

                {/* Terminal Logs */}
                <div className="h-32 overflow-hidden flex flex-col justify-end text-[10px] text-cyan-600/80 border-l-2 border-cyan-900/50 pl-2">
                    {logs.map((log, i) => (
                        <div key={i} className="animate-fade-in-down whitespace-nowrap">
                            <span className="text-cyan-800 mr-2">[{new Date().toLocaleTimeString()}]</span>
                            {log}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
