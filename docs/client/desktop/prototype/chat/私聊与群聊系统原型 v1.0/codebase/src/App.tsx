import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ChatApp from './pages/ChatApp';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/chat" element={<ChatApp />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;