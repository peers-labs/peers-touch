import { useEffect, useState } from 'react';
import { useAuthStore } from './store/auth';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './components/DashboardLayout';

/**
 * Root application component.
 * Handles authentication guard: shows login page when unauthenticated,
 * otherwise renders the main dashboard layout.
 */
export default function App() {
  const { isAuthenticated, checkAuth } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth().finally(() => setChecking(false));
  }, [checkAuth]);

  if (checking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span style={{ fontSize: 16, color: '#999' }}>Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <DashboardLayout />;
}
