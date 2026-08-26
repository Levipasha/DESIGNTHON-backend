"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastEvent = exports.io = exports.server = exports.app = exports.checkCorsOrigin = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const api_1 = __importDefault(require("./routes/api"));
const db_1 = require("./config/db");
dotenv_1.default.config();
const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'https://designthon.skywebdev.xyz',
    'https://designathon.skywebdev.xyz',
    'https://admin.designthon.skywebdev.xyz',
    'https://admin.skywebdev.xyz'
];
const checkCorsOrigin = (origin) => {
    if (!origin)
        return true;
    const cleanOrigin = origin.replace(/\/+$/, '').toLowerCase();
    // Check default allowed list
    if (defaultAllowedOrigins.some(o => o.toLowerCase() === cleanOrigin))
        return true;
    // Check env variable list
    if (process.env.FRONTEND_URL) {
        const envOrigins = process.env.FRONTEND_URL.split(',').map(o => o.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
        if (envOrigins.includes(cleanOrigin))
            return true;
    }
    // Allow any skywebdev.xyz subdomain (e.g. https://designthon.skywebdev.xyz, https://admin.skywebdev.xyz)
    if (/^https?:\/\/([a-zA-Z0-9-]+\.)*skywebdev\.xyz(:[0-9]+)?$/.test(cleanOrigin)) {
        return true;
    }
    // Allow any Vercel deployment domains
    if (/^https?:\/\/([a-zA-Z0-9-]+\.)*vercel\.app(:[0-9]+)?$/.test(cleanOrigin)) {
        return true;
    }
    // Allow any localhost / 127.0.0.1 port
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(cleanOrigin)) {
        return true;
    }
    return false;
};
exports.checkCorsOrigin = checkCorsOrigin;
exports.app = (0, express_1.default)();
exports.server = http_1.default.createServer(exports.app);
exports.io = new socket_io_1.Server(exports.server, {
    cors: {
        origin: (origin, callback) => {
            if ((0, exports.checkCorsOrigin)(origin)) {
                callback(null, true);
            }
            else {
                console.warn(`[Socket CORS] Origin rejected: ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: true
    }
});
exports.app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if ((0, exports.checkCorsOrigin)(origin)) {
            callback(null, true);
        }
        else {
            console.warn(`[Express CORS] Origin rejected: ${origin}`);
            callback(new Error(`CORS Error: Origin ${origin} not allowed`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true
}));
exports.app.use(express_1.default.json());
// API Routes
exports.app.use('/api', api_1.default);
// Basic health check
exports.app.get('/', (req, res) => {
    res.json({ message: 'DESIGNTHON API server running...' });
});
// Socket.IO real-time communication
exports.io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);
    // User joins their personal room for notifications
    socket.on('join_user_room', (userId) => {
        socket.join(userId);
        console.log(`[Socket] User ${userId} joined personal room`);
    });
    // User joins a team room for team-updates
    socket.on('join_team_room', (teamId) => {
        socket.join(teamId);
        console.log(`[Socket] User joined team room: ${teamId}`);
    });
    // Notify team leader of a new join request
    socket.on('new_join_request', (data) => {
        socket.to(data.leaderId).emit('join_request_received', {
            teamId: data.teamId,
            message: `${data.requesterName} has requested to join your team.`
        });
    });
    // Notify user of request approval or rejection
    socket.on('request_response', (data) => {
        socket.to(data.userId).emit('request_response_received', {
            teamId: data.teamId,
            status: data.status,
            message: data.status === 'approved'
                ? 'Your request to join the team has been approved!'
                : 'Your request to join the team was declined.'
        });
        // If approved, notify the entire team room to update their member list
        if (data.status === 'approved') {
            exports.io.to(data.teamId).emit('team_updated');
        }
    });
    // Broadcast team changes (members leaving, role edits)
    socket.on('team_modified', (teamId) => {
        exports.io.to(teamId).emit('team_updated');
    });
    // Admin broad notification trigger
    socket.on('admin_broadcast', (data) => {
        exports.io.emit('broadcast_received', data);
    });
    socket.on('disconnect', () => {
        console.log(`[Socket] User disconnected: ${socket.id}`);
    });
});
const broadcastEvent = (eventName, data) => {
    if (exports.io) {
        exports.io.emit(eventName, data);
    }
};
exports.broadcastEvent = broadcastEvent;
const PORT = process.env.PORT || 5000;
async function startServer() {
    try {
        // Connect to MongoDB Atlas
        await (0, db_1.connectDatabase)();
        // Seed default data
        await (0, db_1.seedDatabase)();
        exports.server.listen(PORT, () => {
            console.log(`[Server] Express server listening on http://localhost:${PORT}`);
        });
    }
    catch (error) {
        console.error('[Server] Initialization failed:', error);
        process.exit(1);
    }
}
startServer();
