
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;
const TICK_RATE = 20; // 20 Updates per second
const TICK_INTERVAL = 1000 / TICK_RATE;

// --- EXPRESS SERVER ---
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../dist')));

const server = app.listen(PORT, () => {
    console.log(`🚀 HYBRID GAME SERVER (JSON Events + Binary Physics) running on port ${PORT}`);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ server });

// Short ID Generator (For Binary Packing)
let nextEntityId = 1;
function getNextNetId() {
    if (nextEntityId > 60000) nextEntityId = 1; 
    return nextEntityId++;
}

const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            players: new Map(),
            loopId: null
        });
        startRoomLoop(roomId);
        console.log(`[SERVER] Room Created: ${roomId}`);
    }
    return rooms.get(roomId);
}

// --- BINARY PACKING (Movement Only) ---
function createWorldSnapshotBuffer(players, timestamp) {
    // Header: Type(1) + Time(8) + Count(2) = 11 bytes
    // Body per player: ID(2) + X(2) + Y(2) + Rot(1) + HP(1) + Score(2) = 10 bytes
    const entitySize = 10; 
    const bufferSize = 11 + (players.size * entitySize); 
    const buffer = Buffer.alloc(bufferSize);
    
    let offset = 0;
    
    // Header
    buffer.writeUInt8(2, offset); offset += 1; // Packet Type 2 = World Update
    buffer.writeDoubleLE(timestamp, offset); offset += 8; // Server Timestamp
    buffer.writeUInt16LE(players.size, offset); offset += 2; // Entity Count

    players.forEach((ws) => {
        const p = ws.playerData;
        if (!p) return;

        // ID (2 bytes)
        buffer.writeUInt16LE(p.netId, offset); offset += 2;
        
        // Position X, Y (2 bytes each) - Map 0-5000 to 0-65535
        let packX = Math.max(0, Math.min(65535, Math.round(p.x * 10)));
        let packY = Math.max(0, Math.min(65535, Math.round(p.y * 10)));
        buffer.writeUInt16LE(packX, offset); offset += 2;
        buffer.writeUInt16LE(packY, offset); offset += 2;

        // Rotation (1 byte)
        let normRot = (p.r % (Math.PI * 2));
        if (normRot < 0) normRot += Math.PI * 2;
        const packRot = Math.floor((normRot / (Math.PI * 2)) * 255);
        buffer.writeUInt8(packRot, offset); offset += 1;

        // HP % (1 byte)
        const hpPct = Math.max(0, Math.min(100, Math.round((p.hp / p.maxHp) * 100)));
        buffer.writeUInt8(hpPct, offset); offset += 1;

        // Score (2 bytes)
        const packScore = Math.min(65535, Math.floor(p.score));
        buffer.writeUInt16LE(packScore, offset); offset += 2;
    });

    return buffer;
}

function startRoomLoop(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.loopId = setInterval(() => {
        if (room.players.size === 0) return;

        const now = Date.now();

        // 1. Simulate Physics
        room.players.forEach((ws) => {
            if (ws.playerData) {
                // Apply Velocity
                ws.playerData.x += ws.playerData.vx * (TICK_INTERVAL / 1000);
                ws.playerData.y += ws.playerData.vy * (TICK_INTERVAL / 1000);
                
                // Bounds
                ws.playerData.x = Math.max(0, Math.min(5000, ws.playerData.x));
                ws.playerData.y = Math.max(0, Math.min(5000, ws.playerData.y));
            }
        });

        // 2. Broadcast Binary Snapshot (Movement)
        const binaryPacket = createWorldSnapshotBuffer(room.players, now);
        
        room.players.forEach((ws) => {
            if (ws.readyState === 1) ws.send(binaryPacket);
        });

    }, TICK_INTERVAL);
}

wss.on('connection', (ws, req) => {
    // IMPORTANT: Allow both text (JSON) and binary (ArrayBuffer)
    // We do NOT set ws.binaryType here on server, Node handles it automatically.
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room') || 'FFA';
    const userId = url.searchParams.get('uid') || `guest_${Math.random().toString(36).substr(2, 4)}`;
    const userName = url.searchParams.get('name') || 'Player';

    const room = getRoom(roomId);
    const netId = getNextNetId();

    ws.playerData = {
        id: userId,
        netId: netId,
        name: userName,
        x: Math.random() * 4000 + 500,
        y: Math.random() * 4000 + 500,
        vx: 0, vy: 0, r: 0,
        hp: 100, maxHp: 100, score: 0,
        classPath: 'basic'
    };

    room.players.set(userId, ws);

    console.log(`[${roomId}] Join: ${userName} (NetID: ${netId})`);

    // 1. Send Handshake (JSON)
    ws.send(JSON.stringify({ 
        t: 'hello', 
        id: userId, 
        netId: netId 
    }));

    // 2. Send Existing Players (JSON)
    // CRITICAL: New player needs to know who is already there to map NetID -> Entity
    const existing = [];
    room.players.forEach(p => {
        if (p.playerData.id !== userId) {
            existing.push({
                id: p.playerData.id,
                netId: p.playerData.netId,
                name: p.playerData.name,
                x: p.playerData.x,
                y: p.playerData.y,
                classPath: p.playerData.classPath,
                score: p.playerData.score
            });
        }
    });
    if (existing.length > 0) {
        ws.send(JSON.stringify({ t: 'init', d: existing }));
    }

    // 3. Broadcast Join to Others (JSON)
    const joinMsg = JSON.stringify({ 
        t: 'j', 
        d: { 
            id: userId, 
            netId: netId, 
            name: userName, 
            x: ws.playerData.x, 
            y: ws.playerData.y,
            classPath: 'basic'
        } 
    });
    
    room.players.forEach(client => {
        if (client !== ws && client.readyState === 1) client.send(joinMsg);
    });

    ws.on('message', (message, isBinary) => {
        if (!isBinary) {
            try {
                const msg = JSON.parse(message.toString());
                
                // INPUT
                if (msg.t === 'i') {
                    ws.playerData.vx = msg.d.vx;
                    ws.playerData.vy = msg.d.vy;
                    ws.playerData.r = msg.d.r;
                    ws.playerData.x = msg.d.x; // Trust client pos slightly for smoothness
                    ws.playerData.y = msg.d.y;
                }
                
                // CHAT
                if (msg.t === 'c') {
                    const chatPacket = JSON.stringify({ 
                        t: 'c', 
                        d: { sender: userName, content: msg.d } 
                    });
                    // Broadcast to ALL in room
                    room.players.forEach(client => {
                        if (client.readyState === 1) client.send(chatPacket);
                    });
                }

                // STATS SYNC
                if (msg.t === 's') {
                    ws.playerData.hp = msg.d.hp;
                    ws.playerData.maxHp = msg.d.maxHp;
                    ws.playerData.score = msg.d.score;
                    ws.playerData.classPath = msg.d.classPath;
                }

            } catch (e) {
                console.error("Packet Error:", e);
            }
        }
    });

    ws.on('close', () => {
        room.players.delete(userId);
        const leaveMsg = JSON.stringify({ t: 'l', d: { id: userId } });
        room.players.forEach(client => {
            if (client.readyState === 1) client.send(leaveMsg);
        });
        console.log(`[${roomId}] Left: ${userName}`);
    });
});
