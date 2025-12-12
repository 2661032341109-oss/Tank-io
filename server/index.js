
import express from 'express';
import { WebSocketServer } from 'ws';
import { createClient } from 'redis';
import { createClient as createTursoClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;
const REDIS_URL = process.env.REDIS_URL;
const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

// --- DATABASE SETUP ---
let redisClient;
let tursoClient;

async function initDatabases() {
    if (REDIS_URL) {
        redisClient = createClient({ url: REDIS_URL });
        redisClient.on('error', (err) => console.error('Redis Client Error', err));
        await redisClient.connect();
        console.log("✅ Redis Connected");
    } else {
        console.warn("⚠️ REDIS_URL not set. Falling back to in-memory mode.");
    }

    if (TURSO_URL && TURSO_TOKEN) {
        tursoClient = createTursoClient({
            url: TURSO_URL,
            authToken: TURSO_TOKEN,
        });
        console.log("✅ Turso Connected");
        
        // Initialize Schema if needed
        await tursoClient.execute(`
            CREATE TABLE IF NOT EXISTS player_stats (
                uid TEXT PRIMARY KEY,
                name TEXT,
                high_score INTEGER,
                kills INTEGER,
                last_class TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } else {
        console.warn("⚠️ TURSO_URL/TOKEN not set. Persistence disabled.");
    }
}

initDatabases();

// --- EXPRESS SERVER ---
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Serve static frontend from 'dist' folder (built by vite)
app.use(express.static(path.join(__dirname, '../dist')));

const server = app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ server });

const rooms = new Map(); // Room ID -> { players: Map<id, ws>, entities: [], lastUpdate: number }

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            players: new Map(),
            entities: [],
            lastUpdate: Date.now()
        });
        console.log(`Created Room: ${roomId}`);
    }
    return rooms.get(roomId);
}

wss.on('connection', (ws, req) => {
    // Parse query params for room/user info
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room') || 'FFA';
    const userId = url.searchParams.get('uid') || `guest_${Math.random().toString(36).substr(2, 6)}`;
    const userName = url.searchParams.get('name') || 'Player';

    const room = getRoom(roomId);
    
    // Player Metadata
    const player = {
        id: userId,
        name: userName,
        x: Math.random() * 3000,
        y: Math.random() * 3000,
        vx: 0,
        vy: 0,
        r: 0,
        hp: 100,
        maxHp: 100,
        score: 0,
        classPath: 'basic',
        teamId: null
    };

    // Attach player data to the socket for easy retrieval (Standard Practice)
    ws.playerData = player;

    // --- STANDARD SYNC: Send Existing Players to Newcomer ---
    const existingPlayers = [];
    room.players.forEach((client, pid) => {
        // Filter out self and ensure connection is open
        if (client.readyState === 1 && client.playerData && pid !== userId) {
            existingPlayers.push(client.playerData);
        }
    });

    // Send 'init' packet immediately
    if (existingPlayers.length > 0) {
        ws.send(JSON.stringify({
            t: 'init', // Initialization Type
            d: existingPlayers // Data: Array of players
        }));
    }

    // Register Player
    room.players.set(userId, ws);
    
    // Notify others of join
    broadcast(room, {
        t: 'j', // Join
        d: player
    }, userId);

    console.log(`[${roomId}] Player joined: ${userName} (${userId}). Total: ${room.players.size}`);

    // Handle Messages
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            
            // Input Update
            if (msg.t === 'i') { 
                player.x = msg.d.x;
                player.y = msg.d.y;
                player.vx = msg.d.vx;
                player.vy = msg.d.vy;
                player.r = msg.d.r;
                
                // Broadcast movement to others (Throttle could be added here)
                broadcast(room, {
                    t: 'u', // Update
                    d: { id: userId, ...msg.d }
                }, userId); // Skip sender
            }
            
            // Stats Update (Slow Sync)
            if (msg.t === 's') {
                player.hp = msg.d.hp;
                player.maxHp = msg.d.maxHp;
                player.score = msg.d.score;
                player.classPath = msg.d.classPath;
                
                broadcast(room, {
                    t: 'u',
                    d: { id: userId, hp: player.hp, maxHp: player.maxHp, score: player.score, classPath: player.classPath }
                }, userId);
            }

            // Chat
            if (msg.t === 'c') {
                broadcast(room, {
                    t: 'c', // Chat
                    d: { sender: userName, content: msg.d }
                });
            }

        } catch (e) {
            console.error("Packet Error:", e);
        }
    });

    ws.on('close', async () => {
        room.players.delete(userId);
        broadcast(room, { t: 'l', d: { id: userId } });
        console.log(`[${roomId}] Player left: ${userName}`);

        // --- PERSISTENCE (Turso) ---
        if (tursoClient) {
            try {
                await tursoClient.execute({
                    sql: `INSERT INTO player_stats (uid, name, high_score, kills, last_class) 
                          VALUES (?, ?, ?, ?, ?) 
                          ON CONFLICT(uid) DO UPDATE SET 
                          high_score = MAX(high_score, ?), 
                          kills = kills + ?, 
                          last_class = ?, 
                          updated_at = CURRENT_TIMESTAMP`,
                    args: [
                        userId, userName, player.score, 0, player.classPath, // Insert values
                        player.score, 0, player.classPath // Update values
                    ]
                });
                console.log(`Saved stats for ${userName}`);
            } catch (e) {
                console.error("Turso Save Error:", e);
            }
        }
    });
});

function broadcast(room, packet, excludeId = null) {
    const data = JSON.stringify(packet);
    room.players.forEach((client, id) => {
        if (id !== excludeId && client.readyState === 1) {
            client.send(data);
        }
    });
}

// --- REDIS HEARTBEAT (Optional: For scaling later) ---
if (redisClient) {
    setInterval(async () => {
        try {
            // Keep room counts in Redis for lobby
            for (const [roomId, room] of rooms) {
                await redisClient.set(`room:${roomId}:count`, room.players.size.toString(), { EX: 10 });
            }
        } catch (e) {
            console.error("Redis Sync Error", e);
        }
    }, 5000);
}
