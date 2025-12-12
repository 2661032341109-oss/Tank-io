
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
    private myNetId: number | null = null;
    
    private ws: WebSocket | null = null;

    // --- SNAPSHOT INTERPOLATION BUFFER ---
    private snapshots: Snapshot[] = [];
    private netIdMap: Map<number, string> = new Map(); // Map Numeric ID -> String ID
    private serverTimeOffset: number = 0;
    private renderDelay: number = 100;

    constructor() {}

    connect(region: ServerRegion, playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        console.log(`[NET] Connecting to ${region.name}...`);
        if (region.url.startsWith('ws')) {
            this.connectWebSocket(region.url, playerInfo);
        } else {
            this.startFirebaseConnection(playerInfo); 
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

    // --- PACKET HANDLING ---
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
        this.ws.binaryType = "arraybuffer"; // CRITICAL: We want binary frames as ArrayBuffer

        this.ws.onopen = () => {
            console.log("[WS] Connected");
            this.isConnected = true;
            this.emit('connected', { isHost: false });
        };

        this.ws.onmessage = (event) => {
            // HYBRID PROTOCOL CHECK
            if (event.data instanceof ArrayBuffer) {
                // BINARY FRAME (Physics/Movement)
                this.processBinaryPacket(event.data);
            } else {
                // TEXT FRAME (JSON Events: Chat, Join, Leave)
                try {
                    const msg = JSON.parse(event.data as string);
                    this.handleJsonPacket(msg);
                } catch (e) {
                    console.error("[WS] JSON Parse error", e);
                }
            }
        };
        
        this.ws.onclose = () => { this.isConnected = false; this.emit('disconnected', {}); };
        this.ws.onerror = (e) => console.error("[WS] Error", e);
    }

    private handleJsonPacket(msg: any) {
        if (msg.t === 'hello') {
            this.myNetId = msg.netId;
            this.netIdMap.set(msg.netId, this.myId!);
            console.log(`[WS] Handshake. NetID: ${this.myNetId}`);
        }
        else if (msg.t === 'init') {
            // Received list of existing players
            msg.d.forEach((p: any) => {
                this.netIdMap.set(p.netId, p.id);
                this.emit('player_joined', p); // Inform GameEngine to spawn them
            });
        }
        else if (msg.t === 'j') {
            // New player joined
            this.netIdMap.set(msg.d.netId, msg.d.id);
            if (msg.d.id !== this.myId) {
                this.emit('player_joined', msg.d);
            }
        }
        else if (msg.t === 'l') {
            // Player left
            // We need to clean up netIdMap too, though it's not strictly critical
            // Reverse lookup is expensive, so we just leak the int ID mapping or clear on disconnect
            this.emit('player_left', msg.d);
        }
        else if (msg.t === 'c') {
            // Chat message
            this.emit('chat_message', msg.d);
        }
    }

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

            const now = Date.now();
            this.serverTimeOffset = serverTime - now; 

            for (let i = 0; i < count; i++) {
                const netId = view.getUint16(offset, true); offset += 2;
                
                // Unpack Position (0-65535 -> 0-5000)
                const x = (view.getUint16(offset, true) / 10); offset += 2;
                const y = (view.getUint16(offset, true) / 10); offset += 2;
                
                // Unpack Rotation
                const rotByte = view.getUint8(offset); offset += 1;
                const r = (rotByte / 255) * (Math.PI * 2);

                const hpPct = view.getUint8(offset); offset += 1;
                const score = view.getUint16(offset, true); offset += 2;

                snapshot.entities.set(netId, { x, y, r, hpPct });
            }

            this.snapshots.push(snapshot);
            if (this.snapshots.length > 20) this.snapshots.shift();
        }
    }

    // --- GAME LOOP INTERFACE ---
    public processInterpolation(entities: Entity[]) {
        if (this.snapshots.length < 2) return;

        const now = Date.now();
        const renderTime = now + this.serverTimeOffset - this.renderDelay;

        // Find surrounding snapshots
        let prev: Snapshot | null = null;
        let next: Snapshot | null = null;

        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const snap = this.snapshots[i];
            if (snap.time <= renderTime) {
                prev = snap;
                next = this.snapshots[i + 1];
                break;
            }
        }

        if (!prev || !next) return;

        const total = next.time - prev.time;
        const current = renderTime - prev.time;
        const ratio = Math.max(0, Math.min(1, current / total));

        next.entities.forEach((nextState, netId) => {
            if (netId === this.myNetId) return; // Don't interpolate self

            const stringId = this.netIdMap.get(netId);
            if (!stringId) return; 

            const entity = entities.find(e => e.id === stringId);
            const prevState = prev!.entities.get(netId);

            if (entity && prevState) {
                // Linear Interpolation
                entity.pos.x = prevState.x + (nextState.x - prevState.x) * ratio;
                entity.pos.y = prevState.y + (nextState.y - prevState.y) * ratio;
                
                // Rot Interpolation
                let da = nextState.r - prevState.r;
                if (da > Math.PI) da -= Math.PI * 2;
                if (da < -Math.PI) da += Math.PI * 2;
                entity.rotation = prevState.r + da * ratio;

                entity.health = (nextState.hpPct / 100) * entity.maxHealth;
            }
        });
    }

    // Client -> Server Input
    syncPlayerState(pos: {x: number, y: number}, vel: {x: number, y: number}, rotation: number) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
        if (this.ws && this.ws.readyState === WebSocket.OPEN && Math.random() < 0.05) {
             this.ws.send(JSON.stringify({ t: 's', d: { hp: health, maxHp: maxHealth, score, classPath } }));
        }
    }

    sendChat(message: string, sender: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ t: 'c', d: message }));
        }
    }

    // --- EVENT LISTENERS ---
    on(event: string, handler: NetworkEventHandler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
    }

    private emit(event: string, data: any) {
        if (this.handlers[event]) this.handlers[event].forEach(handler => handler(data));
    }
    
    // Legacy / Mock Stubs
    syncWorldEntities(entities: Entity[]) {} 
    private async startFirebaseConnection(playerInfo: any) { }
    private startMockSimulation() { }
}
