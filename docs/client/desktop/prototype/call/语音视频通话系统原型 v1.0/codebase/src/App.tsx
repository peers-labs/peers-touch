import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CallApp from './pages/CallApp';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/chat" element={<CallApp />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
