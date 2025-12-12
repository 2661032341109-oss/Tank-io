
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;
const TICK_RATE = 20; // 20 Hz (Standard)
const TICK_INTERVAL = 1000 / TICK_RATE;

// --- EXPRESS SERVER ---
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../dist')));

const server = app.listen(PORT, () => {
    console.log(`🚀 ULTRA-PERFORMANCE BINARY SERVER running on port ${PORT}`);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ server });

// Short ID Generator (For Binary Packing)
let nextEntityId = 1;
function getNextId() {
    if (nextEntityId > 65000) nextEntityId = 1; // Loop around UInt16
    return nextEntityId++;
}

const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            players: new Map(),
            entities: new Map(), // All game objects
            loopId: null
        });
        startRoomLoop(roomId);
        console.log(`[SERVER] Room Created: ${roomId}`);
    }
    return rooms.get(roomId);
}

// --- BINARY PACKING HELPERS ---
// Pack format: [Type(1)][Time(8)][Count(2)]...[ID(2)][Type(1)][X(2)][Y(2)][Rot(1)][HP(1)][Score(2)]
function createWorldSnapshotBuffer(players, timestamp) {
    const entitySize = 12; // Bytes per entity
    const bufferSize = 1 + 8 + 2 + (players.size * entitySize); 
    const buffer = Buffer.alloc(bufferSize);
    
    let offset = 0;
    
    // Header
    buffer.writeUInt8(2, offset); offset += 1; // Packet Type 2 = World Update
    buffer.writeDoubleLE(timestamp, offset); offset += 8; // Server Timestamp
    buffer.writeUInt16LE(players.size, offset); offset += 2; // Entity Count

    players.forEach((p) => {
        // ID (2 bytes)
        buffer.writeUInt16LE(p.netId, offset); offset += 2;
        
        // Type Mapping (1 byte) - 0: Player, 1: Enemy, etc.
        buffer.writeUInt8(0, offset); offset += 1; 

        // Position X, Y (2 bytes each) - Mapped 0-5000 to 0-65535 for precision
        // We use simple coordinate * 10 for simplicity (0-5000 becomes 0-50000, fits in UInt16)
        let packX = Math.max(0, Math.min(65000, Math.round(p.x * 10)));
        let packY = Math.max(0, Math.min(65000, Math.round(p.y * 10)));
        buffer.writeUInt16LE(packX, offset); offset += 2;
        buffer.writeUInt16LE(packY, offset); offset += 2;

        // Rotation (1 byte) - Map 0-2PI to 0-255
        let normRot = (p.r % (Math.PI * 2));
        if (normRot < 0) normRot += Math.PI * 2;
        const packRot = Math.floor((normRot / (Math.PI * 2)) * 255);
        buffer.writeUInt8(packRot, offset); offset += 1;

        // HP % (1 byte) - 0-100
        const hpPct = Math.max(0, Math.min(100, Math.round((p.hp / p.maxHp) * 100)));
        buffer.writeUInt8(hpPct, offset); offset += 1;

        // Score (2 bytes) - Cap at 65k for visualization
        const packScore = Math.min(65000, Math.floor(p.score));
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

        // 1. Simulate
        room.players.forEach((ws) => {
            if (ws.playerData) {
                ws.playerData.x += ws.playerData.vx * (TICK_INTERVAL / 1000);
                ws.playerData.y += ws.playerData.vy * (TICK_INTERVAL / 1000);
                ws.playerData.x = Math.max(0, Math.min(5000, ws.playerData.x));
                ws.playerData.y = Math.max(0, Math.min(5000, ws.playerData.y));
            }
        });

        // 2. Broadcast Binary Snapshot
        const binaryPacket = createWorldSnapshotBuffer(room.players.values(), now);
        
        room.players.forEach((ws) => {
            if (ws.readyState === 1) ws.send(binaryPacket);
        });

    }, TICK_INTERVAL);
}

wss.on('connection', (ws, req) => {
    ws.binaryType = 'arraybuffer'; // IMPORTANT for binary mode

    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room') || 'FFA';
    const userId = url.searchParams.get('uid') || `guest`;
    const userName = url.searchParams.get('name') || 'Player';

    const room = getRoom(roomId);
    
    // Assign short network ID for binary packing
    const netId = getNextId();

    ws.playerData = {
        id: userId,
        netId: netId,
        name: userName,
        x: Math.random() * 4000 + 500,
        y: Math.random() * 4000 + 500,
        vx: 0, vy: 0, r: 0,
        hp: 100, maxHp: 100, score: 0
    };

    room.players.set(userId, ws);

    // Initial Handshake (JSON is fine for setup)
    ws.send(JSON.stringify({ t: 'hello', id: userId, netId: netId }));

    // Send existing players (JSON for metadata like Names)
    const existing = [];
    room.players.forEach(p => {
        if (p.playerData.id !== userId) existing.push({ 
            id: p.playerData.id, 
            netId: p.playerData.netId, 
            name: p.playerData.name,
            x: p.playerData.x,
            y: p.playerData.y
        });
    });
    ws.send(JSON.stringify({ t: 'init', d: existing }));

    // Broadcast Join (JSON)
    const joinMsg = JSON.stringify({ 
        t: 'j', 
        d: { id: userId, netId: netId, name: userName, x: ws.playerData.x, y: ws.playerData.y } 
    });
    room.players.forEach(client => {
        if (client !== ws && client.readyState === 1) client.send(joinMsg);
    });

    ws.on('message', (message, isBinary) => {
        if (isBinary) {
            // Handle Binary Input (Future Optimization)
        } else {
            try {
                const msg = JSON.parse(message.toString());
                if (msg.t === 'i') {
                    ws.playerData.vx = msg.d.vx;
                    ws.playerData.vy = msg.d.vy;
                    ws.playerData.r = msg.d.r;
                    ws.playerData.x = msg.d.x;
                    ws.playerData.y = msg.d.y;
                }
            } catch (e) {}
        }
    });

    ws.on('close', () => {
        room.players.delete(userId);
        const leaveMsg = JSON.stringify({ t: 'l', d: { id: userId } });
        room.players.forEach(client => { if (client.readyState === 1) client.send(leaveMsg); });
    });
});
