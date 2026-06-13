import React, { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Mic, MicOff, Video, VideoOff, MessageSquare, PhoneOff, Users, MonitorPlay, StopCircle, MonitorUp } from 'lucide-react';
import { RoomClient } from '../lib/mediasoup-client';
import VideoTile from '../components/VideoTile';
import ChatPanel from '../components/ChatPanel';

export default function CallRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const role = new URLSearchParams(location.search).get('role') || 'customer';
  
  const [joined, setJoined] = useState(false);
  const [userName, setUserName] = useState(role === 'agent' ? 'Support Agent' : '');
  
  const [socket, setSocket] = useState(null);
  const [client, setClient] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  
  const [peers, setPeers] = useState(new Map());
  const [messages, setMessages] = useState([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [error, setError] = useState('');
  const [hasUnread, setHasUnread] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenTrackRef = useRef(null);
  const screenProducerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (screenTrackRef.current) screenTrackRef.current.stop();
      if (socket) socket.disconnect();
    };
  }, [localStream, socket]);

  const handleJoin = async (e) => {
    if(e) e.preventDefault();
    if (!userName.trim()) return;
    
    setJoined(true);

    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('get-chat-history', { sessionId: roomId }, (history) => {
        setMessages(history || []);
      });
    });

    const roomClient = new RoomClient(newSocket, roomId, role, userName, {
      onNewConsumer: (consumer, peerId, appData = {}) => {
        setPeers(prev => {
          const newPeers = new Map(prev);
          const peer = newPeers.get(peerId) || {};
          if (consumer.kind === 'audio') peer.audioTrack = consumer.track;
          if (consumer.kind === 'video') {
             if (appData.type === 'screen') {
                 peer.screenTrack = consumer.track;
             } else {
                 peer.videoTrack = consumer.track;
             }
          }
          newPeers.set(peerId, peer);
          return newPeers;
        });
      },
      onExistingPeers: (existingPeers) => {
        setPeers(prev => {
          const newPeers = new Map(prev);
          existingPeers.forEach(p => {
             newPeers.set(p.peerId, { ...newPeers.get(p.peerId), name: p.name, role: p.role });
          });
          return newPeers;
        });
      }
    });

    setClient(roomClient);

    roomClient.join().then(() => {
      newSocket.emit('get-producers', { sessionId: roomId }, (producers) => {
        producers.forEach(p => roomClient.consume(p.producerId, p.peerId, p.kind, p.appData));
      });
      startLocalMedia(roomClient);
    }).catch(err => {
      setError(err.message || 'Failed to join session');
    });

    newSocket.on('new-producer', ({ producerId, peerId, kind, appData }) => {
      roomClient.consume(producerId, peerId, kind, appData);
    });

    newSocket.on('participant-left', ({ peerId }) => {
      setPeers(prev => {
        const newPeers = new Map(prev);
        const peer = newPeers.get(peerId);
        if (peer) {
           setMessages(msgs => [...msgs, { id: Date.now(), role: 'system', text: `${peer.name || 'A participant'} left the session`, createdAt: new Date().toISOString() }]);
        }
        newPeers.delete(peerId);
        return newPeers;
      });
    });

    newSocket.on('participant-joined', ({ peerId, name, role }) => {
       setPeers(prev => {
          const newPeers = new Map(prev);
          newPeers.set(peerId, { ...newPeers.get(peerId), name, role });
          return newPeers;
       });
       setMessages(prev => [...prev, { id: Date.now(), role: 'system', text: `${name} joined the session`, createdAt: new Date().toISOString() }]);
    });

    newSocket.on('chat-message', (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!isChatOpen) setHasUnread(true);
    });

    newSocket.on('session-ended', () => {
      if (role === 'customer') {
         alert('The session was ended by the Agent.');
         navigate('/ended');
      } else {
         navigate('/dashboard');
      }
    });
  };

  const startLocalMedia = async (roomClient) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      
      if (audioTrack) await roomClient.produce(audioTrack);
      if (videoTrack) await roomClient.produce(videoTrack);
    } catch (err) {
      console.error('Failed to get local media', err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setLocalStream(stream);
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) await roomClient.produce(audioTrack);
      } catch (e) {
        console.error('Failed to get audio too', e);
        setError('Could not access microphone/camera');
      }
    }
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenTrackRef.current) screenTrackRef.current.stop();
      if (screenProducerRef.current) screenProducerRef.current.close();
      setIsScreenSharing(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      screenTrackRef.current = track;
      
      const producer = await client.produce(track, { type: 'screen' });
      screenProducerRef.current = producer;
      setIsScreenSharing(true);

      track.onended = () => {
        setIsScreenSharing(false);
        if (screenProducerRef.current) screenProducerRef.current.close();
      };
    } catch (e) {
      console.error('Failed to share screen', e);
    }
  };

  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
    if (!isChatOpen) setHasUnread(false);
  };

  const handleSendMessage = (text) => {
    if (socket) {
      socket.emit('chat-message', { text });
    }
  };

  const handleUploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return data.url;
  };

  const endCall = async () => {
    if (role === 'agent') {
       if(window.confirm('Do you want to end this session for everyone?')) {
          try {
             if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
                // Brief pause to allow the onstop event to trigger the upload fetch
                await new Promise(r => setTimeout(r, 500));
             }
             await fetch(`http://localhost:3000/api/sessions/${roomId}`, { method: 'DELETE' });
             navigate('/dashboard');
          } catch(e) {
             console.error('Failed to end session', e);
          }
       }
    } else {
       navigate('/ended'); // customer just leaves
    }
  };

  const startRecording = async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const recorder = new MediaRecorder(displayStream, { mimeType: 'video/webm' });
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        recordedChunksRef.current = [];
        displayStream.getTracks().forEach(t => t.stop());
        setIsRecording(false);
        
        const file = new File([blob], 'recording.webm', { type: 'video/webm' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('sessionId', roomId);
        
        await fetch('http://localhost:3000/api/recordings', {
          method: 'POST',
          body: formData
        });
        
        alert('Recording uploaded successfully. It will be available in the dashboard shortly.');
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      
      displayStream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      };

    } catch (err) {
      console.error('Failed to start recording', err);
      alert('Failed to start recording: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  if (error) {
    return (
      <div className="flex-center" style={{ height: '100vh', flexDirection: 'column' }}>
        <div className="error-message">{error}</div>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>Return to Dashboard</button>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="flex-center" style={{ height: '100vh', background: 'var(--bg-base)' }}>
        <div className="card glass-panel" style={{ width: '400px', padding: '3rem 2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h2 style={{ marginBottom: '0.5rem' }}>Join Support Session</h2>
            <p>Session ID: {roomId.substring(0,8)}</p>
          </div>
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Your Name</label>
              <input 
                type="text" 
                className="input-field" 
                placeholder="Enter your name" 
                value={userName}
                onChange={e => setUserName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem', padding: '0.75rem' }}>
              Join Session
            </button>
          </form>
        </div>
      </div>
    );
  }

  const totalParticipants = 1 + peers.size;
  let gridCols = 1;
  if (totalParticipants > 1) gridCols = 2;
  if (totalParticipants > 4) gridCols = 3;

  return (
    <div className="call-container animate-fade-in">
      <div className="video-grid-container">
        
        <div className="flex-between" style={{ padding: '0 1rem', zIndex: 10 }}>
          <div className="badge active flex-center" style={{ gap: '0.5rem', background: 'rgba(0,0,0,0.5)', padding: '0.5rem 1rem' }}>
            <span className="status-indicator online"></span>
            Session: {roomId.substring(0, 8)}
          </div>
          <div className="flex-center" style={{ gap: '0.5rem', background: 'rgba(0,0,0,0.5)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-sm)' }}>
            <Users size={16} /> {totalParticipants}
          </div>
        </div>

        <div className="video-grid" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
          <VideoTile 
            track={localStream?.getVideoTracks()[0]} 
            participantName={`${userName} (You)`} 
            isMirrored={true}
            isMuted={isMuted}
            isVideoOff={isVideoOff}
          />
          {isScreenSharing && (
            <VideoTile 
              track={screenTrackRef.current} 
              participantName="Your Screen" 
              isMirrored={false}
              isMuted={true}
              isVideoOff={false}
            />
          )}
          
          {Array.from(peers.entries()).map(([peerId, peerData]) => (
            <React.Fragment key={peerId}>
              <VideoTile 
                track={peerData.videoTrack}
                participantName={peerData.name || `Participant (${peerId.substring(0, 4)})`}
                isMirrored={false}
                isMuted={false}
                isVideoOff={!peerData.videoTrack}
              />
              {peerData.screenTrack && (
                <VideoTile 
                  track={peerData.screenTrack}
                  participantName={`${peerData.name}'s Screen`}
                  isMirrored={false}
                  isMuted={true}
                  isVideoOff={false}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="controls-bar glass-panel">
          <button className={`btn-icon ${isMuted ? 'active' : ''}`} onClick={toggleMute} title="Toggle Audio">
            {isMuted ? <MicOff /> : <Mic />}
          </button>
          <button className={`btn-icon ${isVideoOff ? 'active' : ''}`} onClick={toggleVideo} title="Toggle Video">
            {isVideoOff ? <VideoOff /> : <Video />}
          </button>
          <button className={`btn-icon ${isScreenSharing ? 'active' : ''}`} onClick={toggleScreenShare} title="Share Screen">
            <MonitorUp />
          </button>
          <button className="btn-icon" onClick={toggleChat} title="Toggle Chat" style={{ position: 'relative' }}>
            <MessageSquare />
            {hasUnread && (
              <span style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, background: 'var(--danger)', borderRadius: '50%' }}></span>
            )}
          </button>
          
          {role === 'agent' && (
            <button 
              className={`btn-icon ${isRecording ? 'active' : ''}`} 
              onClick={isRecording ? stopRecording : startRecording} 
              title={isRecording ? "Stop Recording" : "Start Recording Screen"}
              style={{ color: isRecording ? 'white' : 'var(--danger)', borderColor: isRecording ? 'var(--danger)' : 'var(--border-subtle)' }}
            >
              {isRecording ? <StopCircle /> : <MonitorPlay />}
            </button>
          )}

          <button className="btn-icon" onClick={endCall} title="Leave Call" style={{ background: 'var(--danger)', color: 'white' }}>
            <PhoneOff />
          </button>
        </div>
      </div>

      <ChatPanel 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)}
        messages={messages}
        onSendMessage={handleSendMessage}
        onUploadFile={handleUploadFile}
        role={role}
      />
    </div>
  );
}
