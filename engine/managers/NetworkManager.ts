
import { ServerRegion, GameMode, FactionType } from '../../types';
import { db, auth } from '../../firebase';
import { ref, set, onValue, onDisconnect, push, update, remove, onChildAdded, onChildRemoved } from "firebase/database";

type NetworkEventHandler = (data: any) => void;

export class NetworkManager {
    private handlers: Record<string, NetworkEventHandler[]> = {};
    private isConnected: boolean = false;
    private isMockMode: boolean = false; 
    private myId: string | null = null;
    private roomRef: any = null;
    private playerRef: any = null;

    // Throttling
    private lastInputSendTime: number = 0;
    private lastSlowUpdateSendTime: number = 0;
    private readonly INPUT_RATE = 1000 / 20; // 20 updates per second (Position)
    private readonly SLOW_UPDATE_RATE = 500; // 2 updates per second (HP, Score, Class)

    constructor() {}

    connect(region: ServerRegion, playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        console.log(`[NET] Connecting to ${region.name}...`);
        
        this.isMockMode = region.type === 'LOCAL';

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
        this.isConnected = false;
        console.log("[NET] Disconnected.");
    }

    // --- REALTIME: Fast Sync (Pos, Rot) ---
    syncPlayerState(pos: {x: number, y: number}, rotation: number) {
        if (this.isMockMode || !this.playerRef) return;
        
        const now = Date.now();
        if (now - this.lastInputSendTime < this.INPUT_RATE) return;
        this.lastInputSendTime = now;

        update(this.playerRef, {
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            r: parseFloat(rotation.toFixed(2))
        });
    }

    // --- REALTIME: Slow Sync (HP, Score, Class) ---
    // Called from GameEngine.update()
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
        }).catch(err => console.warn("Sync details error", err));
    }

    sendChat(message: string, sender: string) {
        if (this.isMockMode) return;
        if (!this.roomRef) return;

        const chatRef = ref(db, 'rooms/public/chat');
        push(chatRef, {
            sender: sender,
            content: message,
            timestamp: Date.now()
        });
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

    // --- FIREBASE RTDB LOGIC ---

    private startFirebaseConnection(playerInfo: { name: string; tank: string; mode: GameMode; faction: FactionType }) {
        const userId = auth.currentUser ? auth.currentUser.uid : `guest_${Math.random().toString(36).substr(2, 5)}`;
        this.myId = userId;
        
        // Use a single public room for now
        const roomPath = 'rooms/public';
        this.roomRef = ref(db, roomPath);
        this.playerRef = ref(db, `${roomPath}/players/${userId}`);

        // 1. Set Initial Data
        const initialData = {
            id: userId,
            name: playerInfo.name,
            classPath: playerInfo.tank,
            teamId: playerInfo.faction !== 'NONE' ? playerInfo.faction : userId, // Simple team logic
            x: Math.random() * 3000, // Random Spawn
            y: Math.random() * 3000,
            r: 0,
            hp: 100,
            maxHp: 100,
            score: 0,
            color: '#00ccff', // Will be overridden by client logic but good fallback
            timestamp: Date.now()
        };

        set(this.playerRef, initialData)
            .then(() => {
                this.isConnected = true;
                // Remove me if I disconnect (close tab)
                onDisconnect(this.playerRef).remove();
                this.emit('connected', {});
                console.log("[NET] Joined Firebase Room");
            })
            .catch(err => {
                console.error("Firebase join error:", err);
                this.emit('error', { message: "DB Connection Failed" });
            });

        // 2. Listen for Other Players
        const playersRef = ref(db, `${roomPath}/players`);
        
        onChildAdded(playersRef, (snapshot) => {
            const data = snapshot.val();
            if (data.id === this.myId) return;
            
            this.emit('player_joined', {
                id: data.id,
                name: data.name,
                pos: { x: data.x, y: data.y },
                classPath: data.classPath,
                teamId: data.teamId,
                hp: data.hp,
                maxHp: data.maxHp,
                score: data.score
            });
        });

        onChildRemoved(playersRef, (snapshot) => {
            const data = snapshot.val();
            this.emit('player_left', { id: data.id });
        });

        // 3. Listen for Updates (Movement + Stats)
        onValue(playersRef, (snapshot) => {
            const players = snapshot.val();
            if (!players) return;

            const updates: any[] = [];
            Object.values(players).forEach((p: any) => {
                if (p.id !== this.myId) {
                    updates.push({
                        id: p.id,
                        x: p.x,
                        y: p.y,
                        r: p.r,
                        hp: p.hp,
                        maxHp: p.maxHp,
                        score: p.score,
                        classPath: p.classPath
                    });
                }
            });
            
            // Format to match WorldSnapshot structure expected by GameEngine
            if (updates.length > 0) {
                this.emit('world_update', { entities: updates });
            }
        });

        // 4. Listen for Chat
        const chatRef = ref(db, `${roomPath}/chat`);
        // Limit to last 1 messages on join to avoid spam, then listen for new
        // Note: Real implementation might use query constraints
        onChildAdded(chatRef, (snapshot) => {
            const msg = snapshot.val();
            // Ignore old messages (older than 5 seconds)
            if (Date.now() - msg.timestamp > 5000) return;
            
            this.emit('chat_message', {
                sender: msg.sender,
                content: msg.content,
                isSystem: false
            });
        });
    }

    // --- MOCK LOGIC ---
    private startMockSimulation() {
        console.log("[NET] Local Sandbox");
        this.isConnected = true;
        setTimeout(() => this.emit('connected', {}), 100);
    }
}
