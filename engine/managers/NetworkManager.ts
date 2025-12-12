
import { ServerRegion, GameMode, FactionType, WorldSnapshot } from '../../types';

type NetworkEventHandler = (data: any) => void;

/**
 * UNIVERSAL NETWORK BRIDGE
 * This manager handles the logic for connecting to game servers.
 * It intelligently switches between "Local Mock Mode" (Client-Side)
 * and "Online Mode" (WebSocket) based on the server URL.
 */
export class NetworkManager {
    private handlers: Record<string, NetworkEventHandler[]> = {};
    private socket: WebSocket | null = null;
    private isConnected: boolean = false;
    private isMockMode: boolean = true; 

    // Mock Simulation Timers
    private mockJoinInterval: number | null = null;
    private mockLeaveInterval: number | null = null;
    
    // Throttling Input sending (to 30fps)
    private lastInputSendTime: number = 0;
    private readonly INPUT_RATE = 1000 / 30; 

    constructor() {}

    /**
     * Connects to a game server.
     */
    connect(region: ServerRegion, playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        console.log(`[NET] Initiating connection to ${region.name} (${region.url})...`);
        
        this.isMockMode = region.type === 'LOCAL';

        if (this.isMockMode) {
            this.startMockSimulation(playerInfo);
        } else {
            this.startRealConnection(region.url, playerInfo);
        }
    }

    disconnect() {
        if (this.isMockMode) {
            this.stopMockSimulation();
        } else {
            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }
        }
        this.isConnected = false;
        console.log("[NET] Disconnected.");
    }

    /**
     * Sends input data to server. Throttled to save bandwidth.
     */
    sendInput(inputData: { x: number, y: number, fire: boolean, angle: number }) {
        if (this.isMockMode) return;

        const now = Date.now();
        if (now - this.lastInputSendTime < this.INPUT_RATE) return;
        this.lastInputSendTime = now;

        this.send('i', inputData); // 'i' for Input packet
    }

    /**
     * Generic send function
     */
    send(type: string, data: any) {
        if (this.isMockMode) return;

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // In a real app, use MessagePack or Protobuf for binary efficiency
            this.socket.send(JSON.stringify({ t: type, d: data }));
        }
    }

    on(event: string, handler: NetworkEventHandler) {
        if (!this.handlers[event]) {
            this.handlers[event] = [];
        }
        this.handlers[event].push(handler);
    }

    private emit(event: string, data: any) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(handler => handler(data));
        }
    }

    // --- REAL WEBSOCKET LOGIC ---

    private startRealConnection(url: string, playerInfo: any) {
        try {
            this.socket = new WebSocket(url);
            this.socket.binaryType = "arraybuffer"; 

            this.socket.onopen = () => {
                this.isConnected = true;
                console.log("[NET] WebSocket Connected!");
                this.send('handshake', playerInfo);
                this.emit('connected', {});
            };

            this.socket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    // Handle 'u' (Update) packets efficiently
                    if (msg.t === 'u') {
                        this.emit('world_update', msg.d);
                    } else {
                        this.emit(msg.t, msg.d);
                    }
                } catch (e) {
                    console.error("Invalid packet:", event.data);
                }
            };

            this.socket.onclose = () => {
                this.isConnected = false;
                this.emit('disconnected', {});
                console.log("[NET] Connection lost.");
            };

            this.socket.onerror = (err) => {
                console.error("[NET] WebSocket Error:", err);
                this.emit('error', { message: "Connection Error" });
            };

        } catch (e) {
            console.error("[NET] Failed to create WebSocket:", e);
            this.emit('error', { message: "Connection Failed" });
        }
    }

    // --- MOCK SIMULATION LOGIC (Client-Side Only) ---

    private startMockSimulation(playerInfo: any) {
        console.log("[NET] Starting Local Sandbox Environment...");
        this.isConnected = true;
        
        setTimeout(() => {
            this.emit('connected', {});
        }, 100);

        this.mockJoinInterval = window.setInterval(() => {
            if (Math.random() > 0.7) return;
            this.emit('player_joined', this.generateRandomMockPlayer());
        }, 15000);
        
        this.mockLeaveInterval = window.setInterval(() => {
            if (Math.random() > 0.7) return;
            this.emit('player_left', {}); 
        }, 25000);
    }

    private stopMockSimulation() {
        if (this.mockJoinInterval) clearInterval(this.mockJoinInterval);
        if (this.mockLeaveInterval) clearInterval(this.mockLeaveInterval);
    }

    private generateRandomMockPlayer() {
        const names = ["Shadow", "Viper", "Goliath", "Rogue", "Phoenix", "Titan", "Wraith", "Neon", "Cyber", "Flux"];
        const classes = ['twin', 'sniper', 'machine_gun', 'flank_guard', 'pounder'];
        return {
            id: `player_${Math.random().toString(36).substr(2, 9)}`,
            name: names[Math.floor(Math.random() * names.length)],
            classPath: classes[Math.floor(Math.random() * classes.length)],
            pos: { x: Math.random() * 5000, y: Math.random() * 5000 },
            teamId: Math.random() < 0.5 ? 'BLUE' : 'RED',
        };
    }
}
