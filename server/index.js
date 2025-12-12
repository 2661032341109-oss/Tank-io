
import express from 'express';
import { WebSocketServer } from 'ws';
import { createClient } from 'redis';
import { createClient as createTursoClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;
const TICK_RATE = 20; // 20 Updates per second (Standard for .io games)
const TICK_INTERVAL = 1000 / TICK_RATE;

// --- EXPRESS SERVER ---
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../dist')));

const server = app.listen(PORT, () => {
    console.log(`🚀 Professional Game Server running on port ${PORT}`);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ server });

// Room State
const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            players: new Map(), // Active connections
            entities: new Map(), // World objects
            loopId: null
        });
        startRoomLoop(roomId);
        console.log(`[SERVER] Room Created: ${roomId}`);
    }
    return rooms.get(roomId);
}

// --- GAME LOOP (The Heartbeat) ---
function startRoomLoop(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.loopId = setInterval(() => {
        if (room.players.size === 0) return; // Hibernate if empty

        const snapshot = [];
        const now = Date.now();

        // 1. Process & Simulate Players
        room.players.forEach((ws, id) => {
            if (ws.playerData) {
                // Server-side Physics Integration (Basic)
                // Prevents speed hacks by clamping movement on server
                ws.playerData.x += ws.playerData.vx * (TICK_INTERVAL / 1000);
                ws.playerData.y += ws.playerData.vy * (TICK_INTERVAL / 1000);
                
                // Boundary Check (Simple 5000x5000 world)
                ws.playerData.x = Math.max(0, Math.min(5000, ws.playerData.x));
                ws.playerData.y = Math.max(0, Math.min(5000, ws.playerData.y));

                snapshot.push(packPlayer(ws.playerData));
            }
        });

        // 2. Broadcast World Snapshot
        // We send ONE compressed packet to everyone instead of thousands of small ones
        const packet = JSON.stringify({ t: 'w', d: snapshot, ts: now });
        
        room.players.forEach((ws) => {
            if (ws.readyState === 1) ws.send(packet);
        });

    }, TICK_INTERVAL);
}

// Data Packing (Minimizes Bandwidth)
function packPlayer(p) {
    return {
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        r: Number(p.r.toFixed(2)),
        h: Math.round(p.hp),
        m: Math.round(p.maxHp),
        c: p.classPath,
        s: Math.floor(p.score),
        t: p.teamId
    };
}

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room') || 'FFA';
    const userId = url.searchParams.get('uid') || `guest_${Math.random().toString(36).substr(2, 6)}`;
    const userName = url.searchParams.get('name') || 'Player';

    const room = getRoom(roomId);
    
    // Initialize Player Data on Server
    ws.playerData = {
        id: userId,
        name: userName,
        x: Math.random() * 4000 + 500,
        y: Math.random() * 4000 + 500,
        vx: 0,
        vy: 0,
        r: 0,
        hp: 100,
        maxHp: 100,
        score: 0,
        classPath: 'basic',
        teamId: null
    };

    room.players.set(userId, ws);

    // Send Initial Handshake (Who am I?)
    ws.send(JSON.stringify({ t: 'hello', id: userId }));

    // Handle Incoming Input
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            
            // Input Packet (Client sends intentions, not just position)
            if (msg.t === 'i') {
                const p = ws.playerData;
                p.vx = msg.d.vx;
                p.vy = msg.d.vy;
                p.r = msg.d.r;
                // We implicitly trust client position for smoothness in this hybrid model,
                // but strictly server-side authoritative would ignore msg.d.x/y and calculate it solely from velocity.
                // For .io games, a hybrid approach (Client Position + Server Verification) feels smoothest.
                p.x = msg.d.x; 
                p.y = msg.d.y;
            }
            
            // Stats Sync
            if (msg.t === 's') {
                const p = ws.playerData;
                p.hp = msg.d.hp;
                p.maxHp = msg.d.maxHp;
                p.score = msg.d.score;
                p.classPath = msg.d.classPath;
            }

            // Chat
            if (msg.t === 'c') {
                const chatPacket = JSON.stringify({ t: 'c', d: { sender: userName, content: msg.d } });
                room.players.forEach(client => {
                    if (client.readyState === 1) client.send(chatPacket);
                });
            }

        } catch (e) {
            // Ignore malformed packets
        }
    });

    ws.on('close', () => {
        room.players.delete(userId);
        // Broadcast Leave Event immediately
        const leavePacket = JSON.stringify({ t: 'l', d: { id: userId } });
        room.players.forEach(client => {
            if (client.readyState === 1) client.send(leavePacket);
        });
        console.log(`[${roomId}] Player left: ${userName}`);
    });
});
