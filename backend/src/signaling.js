const { getRouter } = require('./mediasoup');
const { getDb } = require('./db');

const peers = new Map(); // socket.id -> { sessionId, role, name, transports, producers, consumers, token }
const disconnectedPeers = new Map(); // token -> { timeout, peerData }

function setupSignaling(io) {
  io.on('connection', (socket) => {
    
    socket.on('join-session', async ({ sessionId, role, name, token }, callback) => {
      try {
        const db = getDb();
        const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
        if (!session || session.status !== 'active') {
          return callback({ error: 'Session not active or invalid' });
        }

        // Handle Reconnect Grace Window
        if (token && disconnectedPeers.has(token)) {
          const { timeout, peerData } = disconnectedPeers.get(token);
          clearTimeout(timeout);
          disconnectedPeers.delete(token);

          // Restore peer state to the new socket
          peerData.socketId = socket.id;
          peers.set(socket.id, peerData);
          socket.join(sessionId);

          const router = getRouter(sessionId);
          return callback({
            token: token,
            reconnected: true,
            routerRtpCapabilities: router.rtpCapabilities
          });
        }

        socket.join(sessionId);
        
        // Ensure tokens for grace window reconnects
        const userToken = token || Date.now().toString() + Math.random().toString();

        peers.set(socket.id, {
          sessionId,
          role,
          name,
          token: userToken,
          transports: new Map(),
          producers: new Map(),
          consumers: new Map()
        });

        // Log participant joined
        await db.run('INSERT INTO participants (id, sessionId, name, role) VALUES (?, ?, ?, ?)', [socket.id, sessionId, name, role]);

        const router = getRouter(sessionId);
        
        const existingPeers = [];
        peers.forEach((p, peerId) => {
          if (p.sessionId === sessionId && peerId !== socket.id) {
            existingPeers.push({ peerId, name: p.name, role: p.role });
          }
        });

        callback({
          token: userToken,
          routerRtpCapabilities: router.rtpCapabilities,
          existingPeers
        });
        
        // Notify others
        socket.to(sessionId).emit('participant-joined', { peerId: socket.id, role, name });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('createWebRtcTransport', async ({ sessionId, direction }, callback) => {
      try {
        const router = getRouter(sessionId);
        const transport = await router.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });

        transport.on('dtlsstatechange', dtlsState => {
          if (dtlsState === 'closed') transport.close();
        });

        const peer = peers.get(socket.id);
        if(!peer) return callback({error: 'Not joined'});
        
        transport.direction = direction;
        peer.transports.set(transport.id, transport);

        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
          }
        });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
      try {
        const peer = peers.get(socket.id);
        if(!peer) return callback({error: 'Not joined'});
        const transport = peer.transports.get(transportId);
        await transport.connect({ dtlsParameters });
        callback({});
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const peer = peers.get(socket.id);
        if(!peer) return callback({error: 'Not joined'});
        const transport = peer.transports.get(transportId);
        const producer = await transport.produce({ kind, rtpParameters });

        peer.producers.set(producer.id, producer);

        // Notify others to consume this producer
        socket.to(peer.sessionId).emit('new-producer', {
          producerId: producer.id,
          peerId: socket.id,
          kind: producer.kind,
          appData: appData
        });

        callback({ id: producer.id });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('consume', async ({ producerId, rtpCapabilities, sessionId, transportId }, callback) => {
      try {
        const router = getRouter(sessionId);
        if (!router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ error: 'Cannot consume' });
        }
        
        const peer = peers.get(socket.id);
        if(!peer) return callback({error: 'Not joined'});
        const transport = peer.transports.get(transportId);

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });

        peer.consumers.set(consumer.id, consumer);

        consumer.on('transportclose', () => consumer.close());
        consumer.on('producerclose', () => {
          consumer.close();
          socket.emit('producer-closed', { producerId });
        });

        // Find original producer's appData
        let originalAppData = {};
        peers.forEach((p) => {
           if (p.producers.has(producerId)) {
              originalAppData = p.producers.get(producerId).appData;
           }
        });

        callback({
          params: {
            id: consumer.id,
            producerId: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            appData: originalAppData
          }
        });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('resume-consumer', async ({ consumerId }, callback) => {
      try {
        const peer = peers.get(socket.id);
        if(!peer) return callback({error: 'Not joined'});
        const consumer = peer.consumers.get(consumerId);
        await consumer.resume();
        callback({});
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('get-producers', ({ sessionId }, callback) => {
      const producerList = [];
      peers.forEach((p, peerId) => {
        if (p.sessionId === sessionId && peerId !== socket.id) {
          p.producers.forEach(producer => {
            producerList.push({ producerId: producer.id, peerId, kind: producer.kind, appData: producer.appData });
          });
        }
      });
      callback(producerList);
    });

    socket.on('chat-message', async (data) => {
      const peer = peers.get(socket.id);
      if (peer) {
        const db = getDb();
        await db.run('INSERT INTO messages (sessionId, senderId, role, text) VALUES (?, ?, ?, ?)', 
          [peer.sessionId, socket.id, peer.role, data.text]);
        
        io.to(peer.sessionId).emit('chat-message', {
          id: Date.now(),
          senderId: socket.id,
          role: peer.role,
          name: peer.name,
          text: data.text,
          createdAt: new Date().toISOString()
        });
      }
    });

    socket.on('get-chat-history', async ({ sessionId }, callback) => {
       const db = getDb();
       const messages = await db.all('SELECT * FROM messages WHERE sessionId = ? ORDER BY createdAt ASC', [sessionId]);
       callback(messages);
    });

    socket.on('disconnect', () => {
      const peer = peers.get(socket.id);
      if (peer) {
        // Reconnect Grace Window: Wait 15 seconds before full cleanup
        const timeout = setTimeout(async () => {
          disconnectedPeers.delete(peer.token);
          
          peer.consumers.forEach(consumer => consumer.close());
          peer.producers.forEach(producer => producer.close());
          peer.transports.forEach(transport => transport.close());
          socket.to(peer.sessionId).emit('participant-left', { peerId: socket.id });
          
          const db = getDb();
          await db.run('UPDATE participants SET leaveTime = CURRENT_TIMESTAMP WHERE id = ?', [socket.id]);
          
        }, 15000);

        disconnectedPeers.set(peer.token, { timeout, peerData: peer });
        peers.delete(socket.id);
      }
    });
  });
}

module.exports = { setupSignaling };
