import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api';
import { connectDatabase, seedDatabase } from './config/db';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Basic health check
app.get('/', (req, res) => {
  res.json({ message: 'DESIGNTHON API server running...' });
});

// Socket.IO real-time communication
io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);

  // User joins their personal room for notifications
  socket.on('join_user_room', (userId: string) => {
    socket.join(userId);
    console.log(`[Socket] User ${userId} joined personal room`);
  });

  // User joins a team room for team-updates
  socket.on('join_team_room', (teamId: string) => {
    socket.join(teamId);
    console.log(`[Socket] User joined team room: ${teamId}`);
  });

  // Notify team leader of a new join request
  socket.on('new_join_request', (data: { leaderId: string; teamId: string; requesterName: string }) => {
    socket.to(data.leaderId).emit('join_request_received', {
      teamId: data.teamId,
      message: `${data.requesterName} has requested to join your team.`
    });
  });

  // Notify user of request approval or rejection
  socket.on('request_response', (data: { userId: string; teamId: string; status: 'approved' | 'rejected' }) => {
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
  socket.on('team_modified', (teamId: string) => {
    io.to(teamId).emit('team_updated');
  });

  // Admin broad notification trigger
  socket.on('admin_broadcast', (data: { targetType: string; targetId?: string; title: string; message: string }) => {
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
    await connectDatabase();

    // Seed default data
    await seedDatabase();
    
    server.listen(PORT, () => {
      console.log(`[Server] Express server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('[Server] Initialization failed:', error);
    process.exit(1);
  }
}

startServer();
