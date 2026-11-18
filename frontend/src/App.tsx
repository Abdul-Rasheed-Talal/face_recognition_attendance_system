import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { TimetableView } from './components/TimetableView';
import { StudentsView } from './components/StudentsView';
import { AttendanceView } from './components/AttendanceView';
import { GateCameraSettings } from './components/GateCameraSettings';
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

  // Initial Auth Check (Runs once on mount)
  useEffect(() => {
    if (api.getToken()) {
      api.getProfile()
        .then((profile) => setCurrentUser(profile))
        .catch(() => {
          api.logout();
          setCurrentUser(null);
        });
    }

    const handleAuthRequired = () => {
      setCurrentUser(null);
    };
    window.addEventListener('fras_auth_required', handleAuthRequired);

    return () => {
      window.removeEventListener('fras_auth_required', handleAuthRequired);
    };
  }, []);

  // Periodic Telemetry Polling (Every 4 seconds)
  const pollTelemetry = useCallback(async () => {
    try {
      const [sess, s] = await Promise.all([
        api.getActiveSession().catch(() => null),
        api.getDashboardStatistics().catch(() => null),
      ]);
      if (sess) setActiveSession(sess);
      if (s) setStats(s);
    } catch (err) {
      console.debug('Telemetry poll error:', err);
    }
  }, []);

  useEffect(() => {
    pollTelemetry();
    const interval = setInterval(pollTelemetry, 4000);
    return () => clearInterval(interval);
  }, [pollTelemetry]);

  // WebSocket event handler for real-time live events
  const handleLiveEvent = useCallback((event: LiveAttendanceEvent) => {
    setRecentEvents((prev) => [event, ...prev.slice(0, 29)]);
    // Refresh stats when an attendance event arrives
    api.getDashboardStatistics().then(setStats).catch(() => {});
    api.getActiveSession().then(setActiveSession).catch(() => {});
  }, []);

  const { isConnected: isWsConnected } = useWebSocket(handleLiveEvent);

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-stone-50 text-stone-800">
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

        <main className="flex-1 overflow-y-auto p-6 bg-stone-50">
          {currentTab === 'dashboard' && (
            <DashboardView
              stats={stats}
              recentEvents={recentEvents}
              activeSession={activeSession}
              onRefresh={pollTelemetry}
            />
          )}

          {currentTab === 'timetable' && <TimetableView />}

          {currentTab === 'attendance' && <AttendanceView />}

          {currentTab === 'students' && (
            <StudentsView
              currentUser={currentUser}
              onOpenLogin={() => setIsLoginModalOpen(true)}
            />
          )}

          {currentTab === 'camera' && (
            <GateCameraSettings
              currentUser={currentUser}
              cameraHealth={stats?.camera_health}
              onOpenLogin={() => setIsLoginModalOpen(true)}
              onRefresh={pollTelemetry}
            />
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
