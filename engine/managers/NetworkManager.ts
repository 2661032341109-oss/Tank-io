
import { ServerRegion, GameMode, FactionType, Entity, EntityType } from '../../types';
import { db, auth } from '../../firebase';
import firebase from 'firebase/compat/app';

type NetworkEventHandler = (data: any) => void;

export class NetworkManager {
    private handlers: Record<string, NetworkEventHandler[]> = {};
    public isConnected: boolean = false;
    public isMockMode: boolean = false; 
    public isHost: boolean = false; 
    
    private myId: string | null = null;
    private roomRef: firebase.database.Reference | null = null;
    private playerRef: firebase.database.Reference | null = null;
    private hostRef: firebase.database.Reference | null = null;
    private entitiesRef: firebase.database.Reference | null = null;

    private lastInputSendTime: number = 0;
    private lastSlowUpdateSendTime: number = 0;
    private lastWorldSyncTime: number = 0;
    
    private readonly INPUT_RATE = 1000 / 15; 
    private readonly SLOW_UPDATE_RATE = 1000; 
    private readonly WORLD_SYNC_RATE = 1000 / 10; 

    constructor() {}

    connect(region: ServerRegion, playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        console.log(`[NET] Connecting to ${playerInfo.mode} (Region: ${region.name})...`);
        
        // IMPORTANT: We ALWAYS connect to Firebase now to ensure DB writes happen,
        // but we might still treat physics as "Local" (MockMode) for Sandbox.
        // However, to populate the DB list, we must allow the connection logic.
        
        // Only strictly "LOCAL" region types (offline dev) avoid firebase. 
        // Sandbox mode SHOULD connect to DB for chat/presence.
        const isOffline = region.type === 'LOCAL'; 
        this.isMockMode = isOffline || playerInfo.mode === 'SANDBOX';

        if (isOffline) {
            this.startMockSimulation();
        } else {
            this.startFirebaseConnection(playerInfo);
        }
    }

    disconnect() {
        if (this.playerRef) {
            this.playerRef.remove();
            this.playerRef = null;
        }
        if (this.isHost && this.hostRef) {
            this.hostRef.remove(); 
            // In a real game, you might want to keep entities, but for cleanup:
            if (this.entitiesRef) this.entitiesRef.remove();
        }
        
        // Detach listeners
        if (this.roomRef) this.roomRef.off();
        if (this.entitiesRef) this.entitiesRef.off();
        if (this.hostRef) this.hostRef.off();
        
        this.handlers = {};
        this.isConnected = false;
        this.isHost = false;
        console.log("[NET] Disconnected.");
    }

    // --- HOST LOGIC ---
    syncWorldEntities(entities: Entity[]) {
        if (!this.isHost || !this.entitiesRef) return;
        // In Sandbox, we might choose NOT to sync entities to save bandwidth since everything is local anyway,
        // but to "see" things in DB, we can allow it.
        if (this.isMockMode && !this.isConnected) return; // Verify actual connection

        const now = Date.now();
        if (now - this.lastWorldSyncTime < this.WORLD_SYNC_RATE) return;
        this.lastWorldSyncTime = now;

        const syncData: Record<string, any> = {};
        
        entities.forEach(e => {
            if (e.type === EntityType.SHAPE || e.type === EntityType.CRASHER || e.type === EntityType.ENEMY || e.type === EntityType.BOSS) {
                syncData[e.id] = {
                    t: e.type, 
                    x: Math.round(e.pos.x),
                    y: Math.round(e.pos.y),
                    r: parseFloat(e.rotation.toFixed(2)),
                    h: Math.ceil(e.health),
                    m: Math.ceil(e.maxHealth),
                    c: e.color,
                    sz: Math.round(e.radius),
                    bt: (e as any).bossType,
                    st: (e as any).shapeType,
                    v: (e as any).variant,
                    cp: (e as any).classPath
                };
            }
        });

        this.entitiesRef.set(syncData).catch(e => console.warn("Entity Sync fail:", e));
    }

    // --- CLIENT LOGIC ---
    syncPlayerState(pos: {x: number, y: number}, rotation: number) {
        if (!this.playerRef) return;
        
        const now = Date.now();
        if (now - this.lastInputSendTime < this.INPUT_RATE) return;
        this.lastInputSendTime = now;

        this.playerRef.update({
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            r: parseFloat(rotation.toFixed(2))
        }).catch(e => {
            // Suppress minor update errors
        });
    }

    syncPlayerDetails(health: number, maxHealth: number, score: number, classPath: string) {
        if (!this.playerRef) return;

        const now = Date.now();
        if (now - this.lastSlowUpdateSendTime < this.SLOW_UPDATE_RATE) return;
        this.lastSlowUpdateSendTime = now;

        this.playerRef.update({
            hp: Math.round(health),
            maxHp: Math.round(maxHealth),
            score: Math.floor(score),
            classPath: classPath
        }).catch(e => console.warn("Player Detail Sync fail:", e));
    }

    sendChat(message: string, sender: string) {
        if (!this.roomRef) return;
        const chatRef = db.ref(`${this.roomRef.key}/chat`);
        chatRef.push({ sender, content: message, timestamp: Date.now() });
    }

    on(event: string, handler: NetworkEventHandler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
    }

    private emit(event: string, data: any) {
        if (this.handlers[event]) this.handlers[event].forEach(handler => handler(data));
    }

    // --- FIREBASE SETUP ---

    private async startFirebaseConnection(playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        // Ensure Auth
        let user = auth.currentUser;
        if (!user) {
            try {
                const cred = await auth.signInAnonymously();
                user = cred.user;
            } catch(e) {
                console.error("Auth failed", e);
                return;
            }
        }
        
        const userId = user!.uid;
        this.myId = userId;
        
        // IMPORTANT: Ensure the path is clean
        const roomPath = `rooms/${playerInfo.mode}`;
        
        this.roomRef = db.ref(roomPath);
        this.playerRef = db.ref(`${roomPath}/players/${userId}`);
        this.hostRef = db.ref(`${roomPath}/host`);
        this.entitiesRef = db.ref(`${roomPath}/world_entities`);

        console.log(`[NET] Attempting to write player data to: ${roomPath}/players/${userId}`);

        // 1. Try to become Host (simple transaction)
        await this.tryBecomeHost(userId);

        // 2. Set Initial Player Data (FORCE WRITE)
        const initialData = {
            id: userId,
            name: playerInfo.name,
            classPath: playerInfo.tank,
            teamId: playerInfo.faction !== 'NONE' ? playerInfo.faction : userId, 
            x: Math.floor(Math.random() * 2000), 
            y: Math.floor(Math.random() * 2000),
            r: 0,
            hp: 100,
            maxHp: 100,
            score: 0,
            color: '#00ccff',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        };

        this.playerRef.set(initialData)
            .then(() => {
                this.isConnected = true;
                if (this.playerRef) this.playerRef.onDisconnect().remove();
                
                // If I am host, also clear entities on disconnect
                if (this.isHost && this.entitiesRef) this.entitiesRef.onDisconnect().remove();

                this.emit('connected', { isHost: this.isHost });
                console.log(`[NET] Connected! Host: ${this.isHost}`);
            })
            .catch(err => {
                console.error("[NET] FATAL: Could not write to Firebase.", err);
                this.emit('error', { message: "DB Write Failed: " + err.message });
            });

        // 3. Listeners
        const playersRef = db.ref(`${roomPath}/players`);
        
        playersRef.on('child_added', (snapshot) => {
            const data = snapshot.val();
            if (!data || data.id === this.myId) return;
            this.emit('player_joined', data);
        });

        playersRef.on('child_removed', (snapshot) => {
            const data = snapshot.val();
            if (data) this.emit('player_left', { id: data.id });
        });

        playersRef.on('value', (snapshot) => {
            const players = snapshot.val();
            if (!players) return;
            const updates: any[] = [];
            Object.values(players).forEach((p: any) => {
                if (p.id !== this.myId) updates.push(p);
            });
            if (updates.length > 0) this.emit('players_update', updates);
        });

        // 4. Listen for World Entities (Only if I am NOT host)
        if (!this.isHost) {
            this.entitiesRef.on('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this.emit('world_snapshot', data);
                }
            });
        }

        // 5. Host Failover
        this.hostRef.on('value', (snapshot) => {
            if (!snapshot.exists() && !this.isHost && this.isConnected) {
                this.tryBecomeHost(userId).then(() => {
                    if (this.isHost) {
                        this.emit('host_migration', {});
                    }
                });
            }
        });

        // 6. Chat
        const chatRef = db.ref(`${roomPath}/chat`);
        chatRef.on('child_added', (snapshot) => {
            const msg = snapshot.val();
            if (msg && Date.now() - (msg.timestamp || 0) < 10000) {
                this.emit('chat_message', { sender: msg.sender, content: msg.content });
            }
        });
    }

    private async tryBecomeHost(userId: string) {
        if (!this.hostRef) return;
        try {
            const result = await this.hostRef.transaction((currentHost) => {
                if (currentHost === null) {
                    return userId; 
                }
                return undefined; 
            });

            if (result.committed) {
                this.isHost = true;
                this.hostRef.onDisconnect().remove(); 
            }
        } catch (e) {
            console.warn("Host claim check skipped/failed", e);
        }
    }

    private startMockSimulation() {
        console.log("[NET] Local Simulation Mode");
        this.isConnected = true;
        this.isHost = true; 
        setTimeout(() => this.emit('connected', { isHost: true }), 100);
    }
}
