"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const api_1 = __importDefault(require("./routes/api"));
const db_1 = require("./config/db");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    }
});
app.use((0, cors_1.default)({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));
app.use(express_1.default.json());
// API Routes
app.use('/api', api_1.default);
// Basic health check
app.get('/', (req, res) => {
    res.json({ message: 'DESIGNTHON API server running...' });
});
// Socket.IO real-time communication
io.on('connection', (socket) => {
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
            io.to(data.teamId).emit('team_updated');
        }
    });
    // Broadcast team changes (members leaving, role edits)
    socket.on('team_modified', (teamId) => {
        io.to(teamId).emit('team_updated');
    });
    // Admin broad notification trigger
    socket.on('admin_broadcast', (data) => {
        io.emit('broadcast_received', data);
    });
    socket.on('disconnect', () => {
        console.log(`[Socket] User disconnected: ${socket.id}`);
    });
});
const PORT = process.env.PORT || 5000;
async function startServer() {
    try {
        // Connect to MongoDB Atlas
        await (0, db_1.connectDatabase)();
        // Seed default data
        await (0, db_1.seedDatabase)();
        server.listen(PORT, () => {
            console.log(`[Server] Express server listening on http://localhost:${PORT}`);
        });
    }
    catch (error) {
        console.error('[Server] Initialization failed:', error);
        process.exit(1);
    }
}
startServer();
