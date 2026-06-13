const mediasoup = require('mediasoup');

let worker;
const routers = new Map(); // sessionId -> router

async function createWorker() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
}

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    }
  }
];

async function createRouter(sessionId) {
  if (!worker) throw new Error('Worker not initialized');
  const router = await worker.createRouter({ mediaCodecs });
  routers.set(sessionId, router);
  return router;
}

function getRouter(sessionId) {
  return routers.get(sessionId);
}

module.exports = {
  createWorker,
  createRouter,
  getRouter
};
