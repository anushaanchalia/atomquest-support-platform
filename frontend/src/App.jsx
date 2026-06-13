import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import CallRoom from './pages/CallRoom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/room/:roomId" element={<CallRoom />} />
        <Route path="/ended" element={
          <div className="flex-center" style={{ height: '100vh', flexDirection: 'column', background: 'var(--bg-base)' }}>
            <h2>You have left the session.</h2>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>You may now close this window.</p>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
