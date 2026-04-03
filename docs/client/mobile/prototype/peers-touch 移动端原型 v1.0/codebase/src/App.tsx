import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import IMChat from './pages/IMChat';
import IMChatDetail from './pages/IMChatDetail';
import IMAddFriend from './pages/IMAddFriend';
import AIChat from './pages/AIChat';
import Settings from './pages/Settings';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/im" element={<IMChat />} />
          <Route path="/im/chat" element={<IMChatDetail />} />
          <Route path="/im/add-friend" element={<IMAddFriend />} />
          <Route path="/ai" element={<AIChat />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;