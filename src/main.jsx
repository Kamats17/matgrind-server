import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { logEvent } from '@/lib/firebase.js'
import { startRecording } from '../tools/bug-hunting/session-replay/middleware.js';

if (typeof localStorage !== 'undefined' && localStorage.getItem('matgrind:replay:auto') === '1') {
  startRecording();
}

// Global crash reporting for unhandled errors
window.addEventListener('error', (e) => {
  logEvent('unhandled_error', { message: e.message?.slice(0, 100), filename: e.filename?.slice(-50) });
});
window.addEventListener('unhandledrejection', (e) => {
  logEvent('unhandled_rejection', { reason: String(e.reason)?.slice(0, 100) });
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
