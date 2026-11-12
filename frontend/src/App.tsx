import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { StudentsView } from './components/StudentsView';
import { AttendanceView } from './components/AttendanceView';
import { StudentPortalView } from './components/StudentPortalView';
import { SystemTelemetryView } from './components/SystemTelemetryView';
import { LoginModal } from './components/LoginModal';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './services/api';
import { User, LabSession, DashboardStatistics, LiveAttendanceEvent } from './types';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeSession, setActiveSession] = useState<LabSession | null>(null);
  const [stats, setStats] = useState<DashboardStatistics | null>(null);
  const [recentEvents, setRecentEvents] = useState<LiveAttendanceEvent[]>([]);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Load initial data
  const loadInitialData = useCallback(async () => {
    try {
      // Check auth profile if token exists
      if (api.getToken()) {
        try {
          const profile = await api.getProfile();
          setCurrentUser(profile);
        } catch {
          api.logout();
          setCurrentUser(null);
        }
      }

      // Load active session
      const sess = await api.getActiveSession();
      setActiveSession(sess);

      // Load statistics
      const s = await api.getDashboardStatistics();
      setStats(s);
    } catch (err) {
      console.debug('Failed to fetch initial telemetry:', err);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
    const interval = setInterval(loadInitialData, 5000); // 5s polling for dashboard stats
    return () => clearInterval(interval);
  }, [loadInitialData]);

  // WebSocket event handler for real-time live events
  const handleLiveEvent = useCallback((event: LiveAttendanceEvent) => {
    setRecentEvents((prev) => [event, ...prev.slice(0, 24)]);
    // Refresh stats when an attendance event arrives
    api.getDashboardStatistics().then(setStats).catch(() => {});
  }, []);

  const { isConnected: isWsConnected } = useWebSocket(handleLiveEvent);

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-100">
      {/* Top Header */}
      <Navbar
        currentUser={currentUser}
        activeSession={activeSession}
        cameraHealth={stats?.camera_health}
        isWsConnected={isWsConnected}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Content Area with Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          userRole={currentUser?.role}
        />

        <main className="flex-1 overflow-y-auto p-6 bg-slate-900/50">
          {currentTab === 'dashboard' && (
            <DashboardView
              stats={stats}
              recentEvents={recentEvents}
              onRefresh={loadInitialData}
            />
          )}

          {currentTab === 'attendance' && <AttendanceView />}

          {currentTab === 'students' && <StudentsView />}

          {currentTab === 'portal' && <StudentPortalView />}

          {currentTab === 'system' && (
            <SystemTelemetryView cameraHealth={stats?.camera_health} />
          )}
        </main>
      </div>

      {/* Authentication Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={(user) => setCurrentUser(user)}
      />
    </div>
  );
}

export default App;
