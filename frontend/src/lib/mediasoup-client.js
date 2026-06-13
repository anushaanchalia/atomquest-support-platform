import { Device } from 'mediasoup-client';

export class RoomClient {
  constructor(socket, sessionId, role, name, callbacks) {
    this.socket = socket;
    this.sessionId = sessionId;
    this.role = role;
    this.name = name;
    this.device = null;
    this.producerTransport = null;
    this.consumerTransport = null;
    this.producers = new Map();
    this.consumers = new Map();
    this.callbacks = callbacks || {};
  }

  async join() {
    return new Promise((resolve, reject) => {
      // Reconnect token
      const tokenKey = `session_token_${this.sessionId}`;
      const savedToken = sessionStorage.getItem(tokenKey);

      this.socket.emit('join-session', { 
        sessionId: this.sessionId, 
        role: this.role, 
        name: this.name,
        token: savedToken 
      }, async (response) => {
        if (response.error) return reject(new Error(response.error));
        
        if (response.token) {
          sessionStorage.setItem(tokenKey, response.token);
        }

        if (this.callbacks.onExistingPeers && response.existingPeers) {
          this.callbacks.onExistingPeers(response.existingPeers);
        }

        if (!this.device) {
          this.device = new Device();
          await this.device.load({ routerRtpCapabilities: response.routerRtpCapabilities });
        }
        
        // Only recreate transports if not reconnected seamlessly
        if (!response.reconnected) {
          await this.createSendTransport();
          await this.createRecvTransport();
        } else {
          // If we had a seamless reconnect, our old transports are linked to the new socket id
          // on the server, but the client WebRTC connections are still valid.
          console.log('Seamlessly reconnected within grace window');
        }
        
        resolve();
      });
    });
  }

  async createSendTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('createWebRtcTransport', { sessionId: this.sessionId, direction: 'send' }, async ({ params, error }) => {
        if (error) return reject(error);
        
        this.producerTransport = this.device.createSendTransport(params);
        
        this.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          this.socket.emit('connectTransport', {
            transportId: this.producerTransport.id,
            dtlsParameters
          }, (response) => {
            if (response.error) errback(new Error(response.error));
            else callback();
          });
        });

        this.producerTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
          this.socket.emit('produce', {
            transportId: this.producerTransport.id,
            kind,
            rtpParameters,
            appData
          }, (response) => {
            if (response.error) errback(new Error(response.error));
            else callback({ id: response.id });
          });
        });

        resolve();
      });
    });
  }

  async createRecvTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('createWebRtcTransport', { sessionId: this.sessionId, direction: 'recv' }, async ({ params, error }) => {
        if (error) return reject(error);
        
        this.consumerTransport = this.device.createRecvTransport(params);
        
        this.consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          this.socket.emit('connectTransport', {
            transportId: this.consumerTransport.id,
            dtlsParameters
          }, (response) => {
            if (response.error) errback(new Error(response.error));
            else callback();
          });
        });

        resolve();
      });
    });
  }

  async produce(track, appData = {}) {
    if (!this.producerTransport) throw new Error('Producer transport not ready');
    const producer = await this.producerTransport.produce({ track, appData });
    this.producers.set(producer.id, producer);
    return producer;
  }

  async consume(producerId, peerId, kind, appData = {}) {
    return new Promise((resolve, reject) => {
      if (!this.consumerTransport) return reject(new Error('Consumer transport not ready'));
      this.socket.emit('consume', {
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
        sessionId: this.sessionId,
        transportId: this.consumerTransport.id
      }, async ({ params, error }) => {
        if (error) return reject(error);
        
        const consumer = await this.consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
          appData: params.appData || {}
        });

        this.consumers.set(consumer.id, consumer);
        
        this.socket.emit('resume-consumer', { consumerId: consumer.id }, () => {
          if (this.callbacks.onNewConsumer) {
            this.callbacks.onNewConsumer(consumer, peerId, params.appData || {});
          }
          resolve(consumer);
        });
      });
    });
  }
}
