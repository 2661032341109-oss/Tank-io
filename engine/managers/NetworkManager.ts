
import { ServerRegion, GameMode, FactionType, Entity, EntityType } from '../../types';
import { db, auth } from '../../firebase';
import { DatabaseReference, ref, set, update, remove, onDisconnect, onChildAdded, onChildRemoved, onChildChanged, onValue, push, runTransaction, get, child } from "firebase/database";

type NetworkEventHandler = (data: any) => void;

export class NetworkManager {
    private handlers: Record<string, NetworkEventHandler[]> = {};
    public isConnected: boolean = false;
    public isMockMode: boolean = false; 
    public isHost: boolean = false; 
    
    private myId: string | null = null;
    
    // Firebase Refs
    private roomRef: DatabaseReference | null = null;
    private playerRef: DatabaseReference | null = null;
    private hostRef: DatabaseReference | null = null;
    private entitiesRef: DatabaseReference | null = null;

    // WebSocket Ref
    private ws: WebSocket | null = null;

    // Throttling
    private lastInputSendTime: number = 0;
    private lastSlowUpdateSendTime: number = 0;
    private lastWorldSyncTime: number = 0;
    
    // 20 FPS is good balance for Firebase/WS
    private readonly INPUT_RATE = 1000 / 20; 
    private readonly SLOW_UPDATE_RATE = 2000;
    private readonly WORLD_SYNC_RATE = 1000 / 10; 

    constructor() {}

    connect(region: ServerRegion, playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        console.log(`[NET] Connecting to ${region.name} (${playerInfo.mode})...`);
        
        // Determine Mode
        if (region.type === 'LOCAL' || playerInfo.mode === 'SANDBOX') {
            this.isMockMode = true;
            this.startMockSimulation();
        } else if (region.url.startsWith('ws')) {
            // WEBSOCKET MODE (Railway/Node)
            this.connectWebSocket(region.url, playerInfo);
        } else {
            // FIREBASE MODE (Legacy)
            this.startFirebaseConnection(playerInfo);
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.playerRef) {
            remove(this.playerRef);
            this.playerRef = null;
        }
        if (this.isHost && this.hostRef) {
            remove(this.hostRef); 
            if (this.entitiesRef) remove(this.entitiesRef);
        }
        this.handlers = {};
        this.isConnected = false;
        this.isHost = false;
        console.log("[NET] Disconnected.");
    }

    // --- HOST LOGIC ---
    syncWorldEntities(entities: Entity[]) {
        if (!this.isHost || this.isMockMode || !this.entitiesRef) return;

        const now = Date.now();
        if (now - this.lastWorldSyncTime < this.WORLD_SYNC_RATE) return;
        this.lastWorldSyncTime = now;

        const syncData: Record<string, any> = {};
        let count = 0;
        const MAX_ENTITIES_SYNC = 150;

        for (const e of entities) {
            if (count >= MAX_ENTITIES_SYNC) break;

            if (e.type === EntityType.SHAPE || e.type === EntityType.CRASHER || e.type === EntityType.ENEMY || e.type === EntityType.BOSS) {
                const round = (num: number) => Math.round(num * 10) / 10;

                syncData[e.id] = {
                    t: e.type,
                    x: Math.round(e.pos.x),
                    y: Math.round(e.pos.y),
                    // SEND VELOCITY FOR PREDICTION
                    vx: Math.round(e.vel.x),
                    vy: Math.round(e.vel.y),
                    r: round(e.rotation),
                    h: Math.ceil(e.health),
                    m: Math.ceil(e.maxHealth),
                    
                    ...(e.color ? { c: e.color } : {}),
                    ...(e.radius ? { sz: Math.round(e.radius) } : {}),
                    ...((e as any).bossType ? { bt: (e as any).bossType } : {}),
                    ...((e as any).shapeType ? { st: (e as any).shapeType } : {}),
                    ...((e as any).variant ? { v: (e as any).variant } : {}),
                    ...((e as any).classPath ? { cp: (e as any).classPath } : {})
                };
                count++;
            }
        }
        set(this.entitiesRef, syncData).catch((e) => console.warn("Sync dropped", e));
    }

    // --- CLIENT LOGIC ---
    syncPlayerState(pos: {x: number, y: number}, vel: {x: number, y: number}, rotation: number) {
        if (this.isMockMode) return;
        
        const now = Date.now();
        if (now - this.lastInputSendTime < this.INPUT_RATE) return;
        this.lastInputSendTime = now;

        const data = {
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            vx: Math.round(vel.x),
            vy: Math.round(vel.y),
            r: Number(rotation.toFixed(2))
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ t: 'i', d: data }));
        } else if (this.playerRef) {
            update(this.playerRef, data).catch(() => {});
        }
    }

    syncPlayerDetails(health: number, maxHealth: number, score: number, classPath: string) {
        if (this.isMockMode) return;

        const now = Date.now();
        if (now - this.lastSlowUpdateSendTime < this.SLOW_UPDATE_RATE) return;
        this.lastSlowUpdateSendTime = now;

        const data = {
            hp: Math.round(health),
            maxHp: Math.round(maxHealth),
            score: Math.floor(score),
            classPath: classPath
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ t: 's', d: data }));
        } else if (this.playerRef) {
            update(this.playerRef, data).catch(() => {});
        }
    }

    sendChat(message: string, sender: string) {
        if (this.isMockMode) return;
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ t: 'c', d: message }));
        } else if (this.roomRef) {
            const chatRef = child(this.roomRef, 'chat');
            push(chatRef, { sender, content: message, timestamp: Date.now() });
        }
    }

    on(event: string, handler: NetworkEventHandler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
    }

    private emit(event: string, data: any) {
        if (this.handlers[event]) this.handlers[event].forEach(handler => handler(data));
    }

    // --- WEBSOCKET SETUP (RAILWAY) ---
    private connectWebSocket(url: string, playerInfo: any) {
        const userId = auth.currentUser ? auth.currentUser.uid : `guest_${Math.random().toString(36).substr(2, 5)}`;
        this.myId = userId;

        // Construct WS URL with query params for handshake
        // If relative URL (for same-origin deployment), use window.location
        let wsUrl = url;
        if (url === 'public') { // Flag used in LobbyView
             const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
             wsUrl = `${protocol}//${window.location.host}`;
        }

        wsUrl += `?room=${playerInfo.mode}&uid=${userId}&name=${encodeURIComponent(playerInfo.name)}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log("[WS] Connected");
            this.isConnected = true;
            this.emit('connected', { isHost: false }); // WS Server is always host
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data as string);
                
                if (msg.t === 'j') { // Join
                    if (msg.d.id !== this.myId) this.emit('player_joined', msg.d);
                } else if (msg.t === 'init') { // NEW: Initialization packet (Batch Join)
                    if (Array.isArray(msg.d)) {
                        console.log(`[WS] Initializing ${msg.d.length} existing players`);
                        msg.d.forEach((p: any) => {
                            if (p.id !== this.myId) this.emit('player_joined', p);
                        });
                    }
                } else if (msg.t === 'l') { // Leave
                    this.emit('player_left', msg.d);
                } else if (msg.t === 'u') { // Update
                    this.emit('players_update', [msg.d]);
                } else if (msg.t === 'c') { // Chat
                    this.emit('chat_message', msg.d);
                }
            } catch (e) {
                console.error("[WS] Parse error", e);
            }
        };

        this.ws.onclose = () => {
            console.log("[WS] Closed");
            this.isConnected = false;
            this.emit('disconnected', {});
        };

        this.ws.onerror = (e) => {
            console.error("[WS] Error", e);
        };
    }

    // --- FIREBASE SETUP ---

    private async startFirebaseConnection(playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        try {
            const userId = auth.currentUser ? auth.currentUser.uid : `guest_${Math.random().toString(36).substr(2, 5)}`;
            this.myId = userId;
            
            const roomPath = `rooms/${playerInfo.mode}`;
            
            this.roomRef = ref(db, roomPath);
            this.playerRef = ref(db, `${roomPath}/players/${userId}`);
            this.hostRef = ref(db, `${roomPath}/host`);
            this.entitiesRef = ref(db, `${roomPath}/world_entities`);

            await this.tryBecomeHost(userId);

            const initialData = {
                id: userId,
                name: playerInfo.name,
                classPath: playerInfo.tank,
                teamId: playerInfo.faction !== 'NONE' ? playerInfo.faction : userId, 
                x: Math.random() * 3000, 
                y: Math.random() * 3000,
                vx: 0,
                vy: 0,
                r: 0,
                hp: 100,
                maxHp: 100,
                score: 0,
                color: '#00ccff',
                timestamp: Date.now()
            };

            await set(this.playerRef, initialData);
            
            this.isConnected = true;
            if (this.playerRef) onDisconnect(this.playerRef).remove();
            
            this.emit('connected', { isHost: this.isHost });
            console.log(`[NET] Joined ${roomPath}. Am I Host? ${this.isHost}`);

            const playersRef = ref(db, `${roomPath}/players`);
            
            const snapshot = await get(playersRef);
            if (snapshot.exists()) {
                const players = snapshot.val();
                Object.values(players).forEach((p: any) => {
                    if (p.id !== this.myId) this.emit('player_joined', p);
                });
            }

            onChildAdded(playersRef, (snapshot) => {
                const data = snapshot.val();
                if (!data || data.id === this.myId) return;
                this.emit('player_joined', data);
            });

            onChildRemoved(playersRef, (snapshot) => {
                const data = snapshot.val();
                if (data) this.emit('player_left', { id: data.id });
            });

            onChildChanged(playersRef, (snapshot) => {
                const data = snapshot.val();
                if (!data || data.id === this.myId) return;
                this.emit('players_update', [data]);
            });

            if (!this.isHost) {
                onValue(this.entitiesRef, (snapshot) => {
                    if (!this.isConnected) return;
                    const data = snapshot.val();
                    if (data) {
                        this.emit('world_snapshot', data);
                    }
                });
            }

            onValue(this.hostRef, (snapshot) => {
                if (!this.isConnected) return;
                if (!snapshot.exists() && !this.isHost) {
                    this.tryBecomeHost(userId).then(() => {
                        if (this.isHost) {
                            this.emit('host_migration', {});
                        }
                    });
                }
            });

            const chatRef = ref(db, `${roomPath}/chat`);
            onChildAdded(chatRef, (snapshot) => {
                if (!this.isConnected) return;
                const msg = snapshot.val();
                if (msg && Date.now() - msg.timestamp < 10000) {
                    this.emit('chat_message', { sender: msg.sender, content: msg.content });
                }
            });

        } catch (err: any) {
            console.error("Connection Critical Failure:", err);
            this.emit('error', { message: err.message });
        }
    }

    private async tryBecomeHost(userId: string) {
        if (!this.hostRef) return;
        try {
            const result = await runTransaction(this.hostRef, (currentHost) => {
                if (currentHost === null) {
                    return userId; 
                }
                return undefined;
            });

            if (result.committed) {
                this.isHost = true;
                onDisconnect(this.hostRef).remove(); 
            }
        } catch (e) {
        }
    }

    private startMockSimulation() {
        console.log("[NET] Local Sandbox");
        this.isConnected = true;
        this.isHost = true;
        setTimeout(() => this.emit('connected', { isHost: true }), 100);
    }
}
