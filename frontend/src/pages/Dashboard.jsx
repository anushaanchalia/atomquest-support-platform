import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Users, Clock, Plus, ExternalLink, Activity, Trash2, Download } from 'lucide-react';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/sessions');
        if (res.ok) {
          const data = await res.json();
          setSessions(data);
        }
      } catch (err) {
        console.error('Failed to fetch sessions', err);
      }
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateSession = async () => {
    setIsCreating(true);
    try {
      const res = await fetch('http://localhost:3000/api/sessions', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        navigate(`/room/${data.id}?role=agent`);
      }
    } catch (err) {
      console.error('Failed to create session', err);
      alert('Failed to create session. Please ensure the backend is running.');
    } finally {
      setIsCreating(false);
    }
  };

  const copyInviteLink = (sessionId) => {
    const link = `${window.location.origin}/room/${sessionId}?role=customer`;
    navigator.clipboard.writeText(link);
    alert('Invite link copied to clipboard!');
  };

  const forceEndSession = async (sessionId) => {
    if (!window.confirm('Are you sure you want to forcibly end this session for all participants?')) return;
    try {
      const res = await fetch(`http://localhost:3000/api/sessions/${sessionId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: 'ended', endedAt: new Date().toISOString() } : s));
      }
    } catch (err) {
      console.error('Failed to end session', err);
    }
  };

  return (
    <div className="dashboard animate-fade-in">
      <div className="container">
        <header className="dashboard-header">
          <h1>Atomquest Admin Operations</h1>
          <p>Manage real-time support sessions, monitor activity, and view recordings.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '2rem' }}>
          
          <aside>
            <div className="card" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <div style={{ marginBottom: '1rem', color: 'var(--brand-primary)' }}>
                <Activity size={48} />
              </div>
              <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
                {sessions.filter(s => s.status === 'active').length}
              </h2>
              <p>Active Sessions</p>
            </div>
            
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}
              onClick={handleCreateSession}
              disabled={isCreating}
            >
              {isCreating ? <div className="spinner"></div> : <><Plus /> New Support Session</>}
            </button>
            <p style={{marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)'}}>
              Metrics available at <a href="http://localhost:3000/metrics" target="_blank" style={{color:'var(--brand-primary)'}}>/metrics</a>
            </p>
          </aside>

          <main>
            <div className="card glass-panel">
              <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
                <h3 className="flex-center" style={{ gap: '0.5rem' }}>
                  <Video size={20} className="text-brand" /> 
                  Session History
                </h3>
              </div>

              {sessions.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Users size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                  <p>No sessions found.</p>
                </div>
              ) : (
                <div className="sessions-list">
                  {sessions.map(session => {
                    const isActive = session.status === 'active';
                    let durationStr = 'Live';
                    if (session.endedAt) {
                      const mins = Math.round((new Date(session.endedAt) - new Date(session.createdAt)) / 60000);
                      durationStr = `${mins} min`;
                    }

                    return (
                      <div key={session.id} className="session-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div className="flex-between">
                          <div>
                            <div className="flex-center" style={{ gap: '1rem', justifyContent: 'flex-start', marginBottom: '0.25rem' }}>
                              <span style={{ fontWeight: 600 }}>Session {session.id.substring(0, 8)}</span>
                              <span className={`badge ${isActive ? 'active' : 'ended'}`}>
                                {isActive && <span className="status-indicator online" style={{ marginRight: '0.25rem' }}></span>}
                                {session.status}
                              </span>
                            </div>
                            <div className="flex-center" style={{ gap: '1rem', justifyContent: 'flex-start', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                              <span className="flex-center" style={{ gap: '0.25rem' }} title={`Created: ${new Date(session.createdAt).toLocaleString()}`}>
                                <Clock size={14} /> 
                                {durationStr}
                              </span>
                              <span className="flex-center" style={{ gap: '0.25rem' }}>
                                <Users size={14} /> 
                                {session.participantCount || 0} online
                              </span>
                            </div>
                          </div>
                          <div className="flex-center" style={{ gap: '0.5rem' }}>
                            {isActive ? (
                              <>
                                <button 
                                  className="btn btn-icon" 
                                  title="Copy Invite Link"
                                  onClick={() => copyInviteLink(session.id)}
                                >
                                  <ExternalLink size={16} />
                                </button>
                                <button 
                                  className="btn btn-icon" 
                                  title="Force End Session"
                                  onClick={() => forceEndSession(session.id)}
                                  style={{ color: 'var(--danger)' }}
                                >
                                  <Trash2 size={16} />
                                </button>
                                <button 
                                  className="btn btn-primary"
                                  onClick={() => navigate(`/room/${session.id}?role=agent`)}
                                >
                                  Join Call
                                </button>
                              </>
                            ) : (
                              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                                Ended at {new Date(session.endedAt).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Extended Details */}
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.875rem' }}>
                          <div style={{ display: 'flex', gap: '2rem' }}>
                            <div>
                              <strong>Participants ({session.participants?.length || 0}):</strong>
                              <ul style={{ listStyle: 'none', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                {session.participants?.map(p => (
                                  <li key={p.id}>• {p.name || 'Anonymous'} ({p.role}) - Joined {new Date(p.joinTime).toLocaleTimeString()} {p.leaveTime && `- Left ${new Date(p.leaveTime).toLocaleTimeString()}`}</li>
                                ))}
                              </ul>
                            </div>
                            {session.recordings?.length > 0 && (
                              <div>
                                <strong>Recordings:</strong>
                                <ul style={{ listStyle: 'none', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                  {session.recordings.map(r => (
                                    <li key={r.id}>
                                      {r.status === 'processing' ? 'Processing...' : (
                                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex-center" style={{ color: 'var(--brand-primary)', textDecoration: 'none', gap:'0.25rem' }}>
                                          <Download size={14}/> Download Recording
                                        </a>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
          
        </div>
      </div>
    </div>
  );
}
