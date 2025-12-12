
import { ServerRegion, GameMode, FactionType, Entity, EntityType } from '../../types';
import { db, auth } from '../../firebase';
import { DatabaseReference, ref, set, update, remove, onDisconnect, onChildAdded, onChildRemoved, onValue, push, runTransaction, DataSnapshot, child } from "firebase/database";

type NetworkEventHandler = (data: any) => void;

export class NetworkManager {
    private handlers: Record<string, NetworkEventHandler[]> = {};
    public isConnected: boolean = false;
    public isMockMode: boolean = false; 
    public isHost: boolean = false; // NEW: Am I the server?
    
    private myId: string | null = null;
    private roomRef: DatabaseReference | null = null;
    private playerRef: DatabaseReference | null = null;
    private hostRef: DatabaseReference | null = null;
    private entitiesRef: DatabaseReference | null = null;

    // Throttling
    private lastInputSendTime: number = 0;
    private lastSlowUpdateSendTime: number = 0;
    private lastWorldSyncTime: number = 0;
    
    private readonly INPUT_RATE = 1000 / 15; // Player moves (15Hz)
    private readonly SLOW_UPDATE_RATE = 1000; // HP/Score (1Hz)
    private readonly WORLD_SYNC_RATE = 1000 / 10; // Bot/Shape Sync (10Hz) - Host only

    constructor() {}

    connect(region: ServerRegion, playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        console.log(`[NET] Connecting to ${region.name} (${playerInfo.mode})...`);
        
        this.isMockMode = region.type === 'LOCAL' || playerInfo.mode === 'SANDBOX';

        if (this.isMockMode) {
            this.startMockSimulation();
        } else {
            this.startFirebaseConnection(playerInfo);
        }
    }

    disconnect() {
        if (this.playerRef) {
            remove(this.playerRef);
            this.playerRef = null;
        }
        if (this.isHost && this.hostRef) {
            remove(this.hostRef); // Drop host status
            // Optionally clear entities so next host starts fresh
            if (this.entitiesRef) remove(this.entitiesRef);
        }
        
        // Remove all listeners (simplified)
        this.handlers = {};
        this.isConnected = false;
        this.isHost = false;
        console.log("[NET] Disconnected.");
    }

    // --- HOST LOGIC ---
    // Only the Host calls this to update Bots/Shapes for everyone else
    syncWorldEntities(entities: Entity[]) {
        if (!this.isHost || this.isMockMode || !this.entitiesRef) return;

        const now = Date.now();
        if (now - this.lastWorldSyncTime < this.WORLD_SYNC_RATE) return;
        this.lastWorldSyncTime = now;

        // Filter: Only sync Shapes, Crashers, Enemies, and Bosses
        // Do NOT sync players (they sync themselves) or particles
        const syncData: Record<string, any> = {};
        
        entities.forEach(e => {
            if (e.type === EntityType.SHAPE || e.type === EntityType.CRASHER || e.type === EntityType.ENEMY || e.type === EntityType.BOSS) {
                // Optimize: Round numbers to save bandwidth
                syncData[e.id] = {
                    t: e.type, // Type
                    x: Math.round(e.pos.x),
                    y: Math.round(e.pos.y),
                    r: parseFloat(e.rotation.toFixed(2)),
                    h: Math.ceil(e.health),
                    m: Math.ceil(e.maxHealth),
                    c: e.color, // Color
                    sz: Math.round(e.radius), // Size
                    bt: (e as any).bossType, // Boss Type
                    st: (e as any).shapeType, // Shape Type
                    v: (e as any).variant, // Variant
                    cp: (e as any).classPath // Bot Class
                };
            }
        });

        // Use 'set' to replace the world state (Authoritative snapshot)
        set(this.entitiesRef, syncData).catch(() => {});
    }

    // --- CLIENT LOGIC ---
    // Everyone calls this to send their own position
    syncPlayerState(pos: {x: number, y: number}, rotation: number) {
        if (this.isMockMode || !this.playerRef) return;
        
        const now = Date.now();
        if (now - this.lastInputSendTime < this.INPUT_RATE) return;
        this.lastInputSendTime = now;

        update(this.playerRef, {
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            r: parseFloat(rotation.toFixed(2))
        }).catch(() => {});
    }

    syncPlayerDetails(health: number, maxHealth: number, score: number, classPath: string) {
        if (this.isMockMode || !this.playerRef) return;

        const now = Date.now();
        if (now - this.lastSlowUpdateSendTime < this.SLOW_UPDATE_RATE) return;
        this.lastSlowUpdateSendTime = now;

        update(this.playerRef, {
            hp: Math.round(health),
            maxHp: Math.round(maxHealth),
            score: Math.floor(score),
            classPath: classPath
        }).catch(() => {});
    }

    sendChat(message: string, sender: string) {
        if (this.isMockMode) return;
        if (!this.roomRef) return;
        const chatRef = child(this.roomRef, 'chat');
        push(chatRef, { sender, content: message, timestamp: Date.now() });
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
        const userId = auth.currentUser ? auth.currentUser.uid : `guest_${Math.random().toString(36).substr(2, 5)}`;
        this.myId = userId;
        
        // FIXED ROOM: Use a specific region ID so friends always find each other
        const roomPath = `rooms/${playerInfo.mode}`;
        
        this.roomRef = ref(db, roomPath);
        this.playerRef = ref(db, `${roomPath}/players/${userId}`);
        this.hostRef = ref(db, `${roomPath}/host`);
        this.entitiesRef = ref(db, `${roomPath}/world_entities`);

        // 1. Try to become Host
        await this.tryBecomeHost(userId);

        // 2. Set Initial Player Data
        const initialData = {
            id: userId,
            name: playerInfo.name,
            classPath: playerInfo.tank,
            teamId: playerInfo.faction !== 'NONE' ? playerInfo.faction : userId, 
            x: Math.random() * 3000, 
            y: Math.random() * 3000,
            r: 0,
            hp: 100,
            maxHp: 100,
            score: 0,
            color: '#00ccff',
            timestamp: Date.now()
        };

        set(this.playerRef, initialData)
            .then(() => {
                this.isConnected = true;
                if (this.playerRef) onDisconnect(this.playerRef).remove();
                this.emit('connected', { isHost: this.isHost });
                console.log(`[NET] Joined ${roomPath}. Am I Host? ${this.isHost}`);
            })
            .catch(err => {
                console.error("Join Error:", err);
                this.emit('error', { message: "Connection Failed" });
            });

        // 3. Listen for Players
        const playersRef = ref(db, `${roomPath}/players`);
        
        onChildAdded(playersRef, (snapshot) => {
            const data = snapshot.val();
            if (!data || data.id === this.myId) return;
            this.emit('player_joined', data);
        });

        onChildRemoved(playersRef, (snapshot) => {
            const data = snapshot.val();
            if (data) this.emit('player_left', { id: data.id });
        });

        onValue(playersRef, (snapshot) => {
            const players = snapshot.val();
            if (!players) return;
            const updates: any[] = [];
            Object.values(players).forEach((p: any) => {
                if (p.id !== this.myId) updates.push(p);
            });
            if (updates.length > 0) this.emit('players_update', updates);
        });

        // 4. Listen for World Entities (Shapes/Bots)
        // If I am Host, I WRITE this. If I am Client, I READ this.
        if (!this.isHost) {
            onValue(this.entitiesRef, (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this.emit('world_snapshot', data);
                }
            });
        }

        // 5. Host Failover (If host disconnects, try to take over)
        onValue(this.hostRef, (snapshot) => {
            if (!snapshot.exists() && !this.isHost && this.isConnected) {
                // Host is gone! Try to claim.
                this.tryBecomeHost(userId).then(() => {
                    if (this.isHost) {
                        this.emit('host_migration', {}); // Tell GameEngine to start spawning
                    }
                });
            }
        });

        // 6. Chat
        const chatRef = ref(db, `${roomPath}/chat`);
        onChildAdded(chatRef, (snapshot) => {
            const msg = snapshot.val();
            if (msg && Date.now() - msg.timestamp < 10000) {
                this.emit('chat_message', { sender: msg.sender, content: msg.content });
            }
        });
    }

    private async tryBecomeHost(userId: string) {
        if (!this.hostRef) return;
        try {
            const result = await runTransaction(this.hostRef, (currentHost) => {
                if (currentHost === null) {
                    return userId; // Claim it
                }
                return undefined; // Already taken
            });

            if (result.committed) {
                this.isHost = true;
                onDisconnect(this.hostRef).remove(); // If I disconnect, host slot opens
            }
        } catch (e) {
            console.warn("Host claim race condition", e);
        }
    }

    private startMockSimulation() {
        console.log("[NET] Local Sandbox");
        this.isConnected = true;
        this.isHost = true; // Local is always host
        setTimeout(() => this.emit('connected', { isHost: true }), 100);
    }
}
