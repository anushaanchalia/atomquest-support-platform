require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');

const { initDb, getDb } = require('./src/db');
const { createWorker, createRouter } = require('./src/mediasoup');
const { setupSignaling } = require('./src/signaling');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fs = require('fs');
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

const recordingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fs = require('fs');
    const recDir = path.join(__dirname, 'recordings');
    if (!fs.existsSync(recDir)) fs.mkdirSync(recDir);
    cb(null, recDir);
  },
  filename: (req, file, cb) => {
    cb(null, `rec-${Date.now()}-${file.originalname}`);
  }
});
const uploadRecording = multer({ storage: recordingStorage });

let systemErrors = 0;
const originalError = console.error;
console.error = function(...args) {
  systemErrors++;
  originalError.apply(console, args);
};

app.post('/api/sessions', async (req, res) => {
  try {
    const db = getDb();
    const id = uuidv4();
    await db.run('INSERT INTO sessions (id) VALUES (?)', [id]);
    await createRouter(id);
    res.json({ id, status: 'active' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const db = getDb();
    const sessions = await db.all('SELECT * FROM sessions ORDER BY createdAt DESC LIMIT 50');
    const enriched = await Promise.all(sessions.map(async (s) => {
      const room = io.sockets.adapter.rooms.get(s.id);
      const parts = await db.all('SELECT * FROM participants WHERE sessionId = ?', [s.id]);
      const recs = await db.all('SELECT * FROM recordings WHERE sessionId = ?', [s.id]);
      return { 
        ...s, 
        participantCount: room ? room.size : 0,
        participants: parts,
        recordings: recs
      };
    }));
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const db = getDb();
    const session = await db.get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const db = getDb();
    await db.run('UPDATE sessions SET status = ?, endedAt = CURRENT_TIMESTAMP WHERE id = ?', ['ended', req.params.id]);
    
    io.to(req.params.id).emit('session-ended');
    const room = io.sockets.adapter.rooms.get(req.params.id);
    if (room) {
      for (const socketId of room) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) socket.leave(req.params.id);
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `http://localhost:3000/uploads/${req.file.filename}`, name: req.file.originalname });
});

app.post('/api/recordings', uploadRecording.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { sessionId } = req.body;
  try {
    const db = getDb();
    const id = uuidv4();
    const url = `http://localhost:3000/recordings/${req.file.filename}`;
    
    await db.run('INSERT INTO recordings (id, sessionId, status, url) VALUES (?, ?, ?, ?)', [id, sessionId, 'processing', url]);
    
    setTimeout(async () => {
      await db.run('UPDATE recordings SET status = ? WHERE id = ?', ['ready', id]);
    }, 3000);

    res.json({ id, url, status: 'processing' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save recording' });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    const db = getDb();
    const activeSessions = await db.get("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'");
    let connectedParticipants = 0;
    io.sockets.adapter.rooms.forEach((value, key) => {
      if (key.length === 36) {
        connectedParticipants += value.size;
      }
    });

    const metrics = [
      '# HELP active_sessions_total Total number of active sessions',
      '# TYPE active_sessions_total gauge',
      `active_sessions_total ${activeSessions.count}`,
      '# HELP connected_participants_total Total number of connected participants across all sessions',
      '# TYPE connected_participants_total gauge',
      `connected_participants_total ${connectedParticipants}`,
      '# HELP system_errors_total Total number of server errors logged',
      '# TYPE system_errors_total counter',
      `system_errors_total ${systemErrors}`
    ].join('\n');

    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch(err) {
    res.status(500).send(err.message);
  }
});

async function start() {
  await initDb();
  await createWorker();
  setupSignaling(io);

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
  });
}

start();
