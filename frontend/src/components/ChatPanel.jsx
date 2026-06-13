import React, { useState, useEffect, useRef } from 'react';
import { Send, X, MessageSquare, Paperclip, File as FileIcon } from 'lucide-react';

export default function ChatPanel({ isOpen, onClose, messages, onSendMessage, onUploadFile, role }) {
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setIsUploading(true);
    try {
      const url = await onUploadFile(file);
      onSendMessage(`Shared a file: ${url}`);
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setIsUploading(false);
      e.target.value = null;
    }
  };

  const renderMessageText = (text) => {
    if (text.startsWith('Shared a file: ')) {
      const url = text.replace('Shared a file: ', '');
      const isImage = url.match(/\.(jpeg|jpg|gif|png)$/i);
      if (isImage) {
        return (
          <div style={{ marginTop: '0.5rem' }}>
            <img src={url} alt="Shared" style={{ maxWidth: '100%', borderRadius: '4px' }} />
          </div>
        );
      }
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex-center" style={{ gap: '0.5rem', color: 'inherit', textDecoration: 'underline' }}>
          <FileIcon size={16} /> View File
        </a>
      );
    }
    return text;
  };

  return (
    <aside className={`chat-sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="chat-header">
        <h3 className="flex-center" style={{ gap: '0.5rem', margin: 0, fontSize: '1.125rem' }}>
          <MessageSquare size={20} /> Session Chat
        </h3>
        <button className="btn-icon" onClick={onClose} style={{ border: 'none', background: 'transparent' }}>
          <X size={20} />
        </button>
      </div>

      <div className="chat-messages">
        {messages.map((msg, idx) => {
          if (msg.role === 'system') {
             return (
               <div key={msg.id || idx} style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>
                 {msg.text}
               </div>
             );
          }
          const isSelf = msg.role === role; // Simplified for demo
          return (
            <div key={msg.id || idx} className={`message ${isSelf ? 'self' : 'remote'}`}>
              <div className="message-bubble">
                {renderMessageText(msg.text)}
              </div>
              <span className="message-meta">
                {msg.name || (msg.role === 'agent' ? 'Agent' : 'Customer')} • {new Date(msg.createdAt).toLocaleTimeString()}
              </span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <div className="chat-input-wrapper">
          <input 
            type="text" 
            placeholder="Type a message..." 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileChange}
          />
          <button 
            type="button" 
            className="btn-icon" 
            style={{ background: 'transparent', color: 'var(--text-muted)' }}
            onClick={() => fileInputRef.current.click()}
            disabled={isUploading}
          >
            <Paperclip size={18} />
          </button>
          <button type="submit" className="btn-icon" disabled={!inputText.trim() || isUploading}>
            <Send size={16} />
          </button>
        </div>
      </form>
    </aside>
  );
}
