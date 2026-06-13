import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, VideoOff } from 'lucide-react';

export default function VideoTile({ track, participantName, isMirrored, isMuted, isVideoOff }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && track) {
      const stream = new MediaStream([track]);
      videoRef.current.srcObject = stream;
    }
  }, [track]);

  return (
    <div className={`video-tile ${isMirrored ? 'mirrored' : ''}`}>
      {isVideoOff ? (
        <div className="flex-center" style={{ width: '100%', height: '100%', backgroundColor: '#222' }}>
          <VideoOff size={48} color="#64748b" />
        </div>
      ) : (
        <video ref={videoRef} autoPlay playsInline muted={isMirrored} />
      )}
      
      <div className="video-overlay">
        <span className="participant-name">{participantName}</span>
        <div className="flex-center">
          {isMuted && <MicOff size={16} color="var(--danger)" />}
        </div>
      </div>
    </div>
  );
}
