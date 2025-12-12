
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
        
        // Use Mock if explictly sandbox, OR if local region
        this.isMockMode = region.type === 'LOCAL' || playerInfo.mode === 'SANDBOX';

        if (this.isMockMode) {
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
            this.hostRef.remove(); // Drop host status
            if (this.entitiesRef) this.entitiesRef.remove();
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
        
        entities.forEach(e => {
            if (e.type === EntityType.SHAPE || e.type === EntityType.CRASHER || e.type === EntityType.ENEMY || e.type === EntityType.BOSS) {
                // Base Data
                const data: any = {
                    t: e.type,
                    x: Math.round(e.pos.x || 0),
                    y: Math.round(e.pos.y || 0),
                    r: parseFloat((e.rotation || 0).toFixed(2)),
                    h: Math.ceil(e.health || 0),
                    m: Math.ceil(e.maxHealth || 100),
                    c: e.color || '#fff',
                    sz: Math.round(e.radius || 10)
                };

                // Optional Properties - Only add if defined to avoid Firebase 'undefined' error
                const bossType = (e as any).bossType;
                if (bossType) data.bt = bossType;

                const shapeType = (e as any).shapeType;
                if (shapeType) data.st = shapeType;

                const variant = (e as any).variant;
                if (variant) data.v = variant;

                const classPath = (e as any).classPath;
                if (classPath) data.cp = classPath;

                syncData[e.id] = data;
            }
        });

        this.entitiesRef.set(syncData).catch(() => {});
    }

    // --- CLIENT LOGIC ---
    syncPlayerState(pos: {x: number, y: number}, rotation: number) {
        if (this.isMockMode || !this.playerRef) return;
        
        const now = Date.now();
        if (now - this.lastInputSendTime < this.INPUT_RATE) return;
        this.lastInputSendTime = now;

        this.playerRef.update({
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

        this.playerRef.update({
            hp: Math.round(health),
            maxHp: Math.round(maxHealth),
            score: Math.floor(score),
            classPath: classPath || 'basic'
        }).catch(() => {});
    }

    sendChat(message: string, sender: string) {
        if (this.isMockMode) return;
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
        const userId = auth.currentUser ? auth.currentUser.uid : `guest_${Math.random().toString(36).substr(2, 5)}`;
        this.myId = userId;
        
        const roomPath = `rooms/${playerInfo.mode}`;
        
        try {
            this.roomRef = db.ref(roomPath);
            this.playerRef = db.ref(`${roomPath}/players/${userId}`);
            this.hostRef = db.ref(`${roomPath}/host`);
            this.entitiesRef = db.ref(`${roomPath}/world_entities`);

            // Try to become host
            await this.tryBecomeHost(userId);

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

            // CRITICAL FIX: If we can't write within 3 seconds, assume offline/error and fallback to Mock Mode
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject("Timeout"), 3000));
            
            await Promise.race([this.playerRef.set(initialData), timeoutPromise]);

            this.isConnected = true;
            if (this.playerRef) this.playerRef.onDisconnect().remove();
            
            this.emit('connected', { isHost: this.isHost });
            console.log(`[NET] Joined ${roomPath}. Am I Host? ${this.isHost}`);

            // Listeners
            this.setupListeners(roomPath);

        } catch (err) {
            console.error("Firebase Connection Failed (Offline Mode Activated):", err);
            // Fallback to local simulation instantly
            this.startMockSimulation();
        }
    }

    private setupListeners(roomPath: string) {
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

        if (!this.isHost && this.entitiesRef) {
            this.entitiesRef.on('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this.emit('world_snapshot', data);
                }
            });
        }

        if (this.hostRef) {
            this.hostRef.on('value', (snapshot) => {
                if (!snapshot.exists() && !this.isHost && this.isConnected) {
                    this.tryBecomeHost(this.myId!).then(() => {
                        if (this.isHost) {
                            this.emit('host_migration', {});
                        }
                    });
                }
            });
        }

        const chatRef = db.ref(`${roomPath}/chat`);
        chatRef.on('child_added', (snapshot) => {
            const msg = snapshot.val();
            if (msg && Date.now() - msg.timestamp < 10000) {
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
            console.warn("Host claim race condition", e);
        }
    }

    private startMockSimulation() {
        console.log("[NET] Starting Offline Sandbox Mode (Fallback)");
        this.isMockMode = true;
        this.isConnected = true;
        this.isHost = true; 
        setTimeout(() => this.emit('connected', { isHost: true }), 100);
    }
}
