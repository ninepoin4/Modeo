import React from 'react';
import ReactDOM from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import { ToastProvider } from './components/ui/toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  </React.StrictMode>
);
