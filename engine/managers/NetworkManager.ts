
import { ServerRegion, GameMode, FactionType, Entity, EntityType } from '../../types';
import { db, auth } from '../../firebase';
import { DatabaseReference, ref, set, update, remove, onDisconnect, onChildAdded, onChildRemoved, onChildChanged, onValue, push, runTransaction, get, child } from "firebase/database";

// --- INTERPOLATION BUFFER TYPES ---
interface Snapshot {
    time: number;
    entities: Map<number, EntityState>;
}

interface EntityState {
    x: number;
    y: number;
    r: number;
    hpPct: number;
}

type NetworkEventHandler = (data: any) => void;

export class NetworkManager {
    private handlers: Record<string, NetworkEventHandler[]> = {};
    public isConnected: boolean = false;
    public isMockMode: boolean = false; 
    public isHost: boolean = false; 
    
    private myId: string | null = null;
    private myNetId: number | null = null; // Short ID for binary mapping
    
    private ws: WebSocket | null = null;

    // --- SNAPSHOT INTERPOLATION BUFFER ---
    private snapshots: Snapshot[] = [];
    private netIdMap: Map<number, string> = new Map(); // Map Numeric ID -> String ID
    private serverTimeOffset: number = 0;
    private renderDelay: number = 100; // 100ms delay for smoothness

    constructor() {}

    connect(region: ServerRegion, playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        console.log(`[NET] Connecting to ${region.name}...`);
        if (region.url.startsWith('ws')) {
            this.connectWebSocket(region.url, playerInfo);
        } else {
            this.startFirebaseConnection(playerInfo); // Fallback
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.snapshots = [];
        this.netIdMap.clear();
        this.handlers = {};
    }

    // --- BINARY PACKET PROCESSING ---
    private processBinaryPacket(buffer: ArrayBuffer) {
        const view = new DataView(buffer);
        let offset = 0;

        const type = view.getUint8(offset); offset += 1;

        if (type === 2) { // WORLD UPDATE
            const serverTime = view.getFloat64(offset, true); offset += 8;
            const count = view.getUint16(offset, true); offset += 2;

            const snapshot: Snapshot = {
                time: serverTime,
                entities: new Map()
            };

            // Calculate server time offset to sync clocks
            const now = Date.now();
            // Simple sync: average offset (can be improved)
            this.serverTimeOffset = serverTime - now; 

            for (let i = 0; i < count; i++) {
                const netId = view.getUint16(offset, true); offset += 2;
                const type = view.getUint8(offset); offset += 1;
                
                // Unpack Coordinates (Mapped * 10)
                const x = view.getUint16(offset, true) / 10; offset += 2;
                const y = view.getUint16(offset, true) / 10; offset += 2;
                
                // Unpack Rotation (0-255 -> 0-2PI)
                const rotByte = view.getUint8(offset); offset += 1;
                const r = (rotByte / 255) * (Math.PI * 2);

                const hpPct = view.getUint8(offset); offset += 1;
                const score = view.getUint16(offset, true); offset += 2;

                snapshot.entities.set(netId, { x, y, r, hpPct });
            }

            this.snapshots.push(snapshot);
            // Keep buffer small (20 snapshots ~ 1 sec)
            if (this.snapshots.length > 20) this.snapshots.shift();
        }
    }

    // --- MAIN UPDATE LOOP (INTERPOLATION) ---
    // Called by GameEngine every frame
    public processInterpolation(entities: Entity[]) {
        if (this.snapshots.length < 2) return;

        // Calculate Render Time (Current Time - Delay)
        // We render what happened 100ms ago to ensure we have data "surrounding" that moment
        const now = Date.now();
        const renderTime = now + this.serverTimeOffset - this.renderDelay;

        // Find two snapshots surrounding renderTime
        let prev: Snapshot | null = null;
        let next: Snapshot | null = null;

        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const snap = this.snapshots[i];
            if (snap.time <= renderTime) {
                prev = snap;
                next = this.snapshots[i + 1]; // Can be undefined
                break;
            }
        }

        if (!prev || !next) return; // Not enough data yet

        // Interpolation Factor (0.0 to 1.0)
        const total = next.time - prev.time;
        const current = renderTime - prev.time;
        const ratio = Math.max(0, Math.min(1, current / total));

        // Apply to Entities
        next.entities.forEach((nextState, netId) => {
            if (netId === this.myNetId) return; // Don't interpolate self (Prediction handles self)

            const stringId = this.netIdMap.get(netId);
            if (!stringId) return; // Entity not known yet

            const entity = entities.find(e => e.id === stringId);
            const prevState = prev!.entities.get(netId);

            if (entity && prevState) {
                // Smooth LERP
                entity.pos.x = prevState.x + (nextState.x - prevState.x) * ratio;
                entity.pos.y = prevState.y + (nextState.y - prevState.y) * ratio;
                
                // Angle Lerp (Shortest path)
                let da = nextState.r - prevState.r;
                if (da > Math.PI) da -= Math.PI * 2;
                if (da < -Math.PI) da += Math.PI * 2;
                entity.rotation = prevState.r + da * ratio;

                // Sync HP (Visual only)
                entity.health = (nextState.hpPct / 100) * entity.maxHealth;
            }
        });
    }

    // ... (Old Sync methods kept for compatibility with Firebase fallback) ...
    syncPlayerState(pos: {x: number, y: number}, vel: {x: number, y: number}, rotation: number) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Sending Input as JSON is fine for now (Client->Server bandwidth is low)
            // Ideally this would be binary too
            this.ws.send(JSON.stringify({ 
                t: 'i', 
                d: { 
                    x: Math.round(pos.x), 
                    y: Math.round(pos.y), 
                    vx: Math.round(vel.x), 
                    vy: Math.round(vel.y), 
                    r: Number(rotation.toFixed(2)) 
                } 
            }));
        }
    }
    
    syncPlayerDetails(health: number, maxHealth: number, score: number, classPath: string) {
        // Reduced frequency updates can stay JSON
        if (this.ws && this.ws.readyState === WebSocket.OPEN && Math.random() < 0.05) {
             this.ws.send(JSON.stringify({ t: 's', d: { hp: health, maxHp: maxHealth, score, classPath } }));
        }
    }

    private connectWebSocket(url: string, playerInfo: any) {
        const userId = auth.currentUser ? auth.currentUser.uid : `guest_${Math.random().toString(36).substr(2, 5)}`;
        this.myId = userId;

        let wsUrl = url;
        if (url === 'public') {
             const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
             wsUrl = `${protocol}//${window.location.host}`;
        }
        wsUrl += `?room=${playerInfo.mode}&uid=${userId}&name=${encodeURIComponent(playerInfo.name)}`;

        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = "arraybuffer"; // CRITICAL

        this.ws.onopen = () => {
            console.log("[WS] Connected");
            this.isConnected = true;
            this.emit('connected', { isHost: false });
        };

        this.ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                this.processBinaryPacket(event.data);
            } else {
                try {
                    const msg = JSON.parse(event.data as string);
                    
                    if (msg.t === 'hello') {
                        this.myNetId = msg.netId;
                        this.netIdMap.set(msg.netId, this.myId!);
                        console.log(`[WS] Handshake. NetID: ${this.myNetId}`);
                    }
                    else if (msg.t === 'init') {
                        msg.d.forEach((p: any) => {
                            this.netIdMap.set(p.netId, p.id);
                            this.emit('player_joined', p);
                        });
                    }
                    else if (msg.t === 'j') {
                        this.netIdMap.set(msg.d.netId, msg.d.id);
                        if (msg.d.id !== this.myId) this.emit('player_joined', msg.d);
                    }
                    else if (msg.t === 'l') {
                        this.emit('player_left', msg.d);
                    }
                    else if (msg.t === 'c') {
                        this.emit('chat_message', msg.d);
                    }
                } catch (e) { console.error(e); }
            }
        };
        
        this.ws.onclose = () => { this.isConnected = false; this.emit('disconnected', {}); };
    }

    // ... (Legacy Firebase methods kept for fallback) ...
    sendChat(message: string, sender: string) {
        if (this.ws) this.ws.send(JSON.stringify({ t: 'c', d: message }));
    }
    
    // --- HOST LOGIC (STUB) ---
    // In Binary Mode, Host Logic is server-side.
    syncWorldEntities(entities: Entity[]) {} 

    on(event: string, handler: NetworkEventHandler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
    }

    private emit(event: string, data: any) {
        if (this.handlers[event]) this.handlers[event].forEach(handler => handler(data));
    }
    
    // Stub for Firebase fallback
    private async startFirebaseConnection(playerInfo: any) { }
    private startMockSimulation() { }
}