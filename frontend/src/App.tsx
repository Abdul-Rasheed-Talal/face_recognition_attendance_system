import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { AnalyticsView } from './components/AnalyticsView';
import { TimetableView } from './components/TimetableView';
import { StudentsView } from './components/StudentsView';
import { AttendanceView } from './components/AttendanceView';
import { AcademicYearView } from './components/AcademicYearView';
import { GateCameraSettings } from './components/GateCameraSettings';
import { ProjectorView } from './components/ProjectorView';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './services/api';
import { LabSession, DashboardStatistics, LiveAttendanceEvent } from './types';

export function App() {
  const [isProjectorMode, setIsProjectorMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('display') === 'projector';
  });
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [activeSession, setActiveSession] = useState<LabSession | null>(null);
  const [stats, setStats] = useState<DashboardStatistics | null>(null);
  const [recentEvents, setRecentEvents] = useState<LiveAttendanceEvent[]>([]);

  // Periodic Telemetry Polling (Every 4 seconds)
  const pollTelemetry = useCallback(async () => {
    try {
      const [sess, s] = await Promise.all([
        api.getActiveSession().catch(() => null),
        api.getDashboardStatistics().catch(() => null),
      ]);
      setActiveSession(sess);
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
    api.getDashboardStatistics().then(setStats).catch(() => {});
    api.getActiveSession().then(setActiveSession).catch(() => {});
  }, []);

  const { isConnected: isWsConnected } = useWebSocket(handleLiveEvent);

  if (isProjectorMode) {
    return (
      <ProjectorView
        onExitProjector={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('display');
          window.history.replaceState({}, '', url.toString());
          setIsProjectorMode(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-stone-50 text-stone-800">
      {/* Top Header (No Login / Signup) */}
      <Navbar
        activeSession={activeSession}
        cameraHealth={stats?.camera_health}
        isWsConnected={isWsConnected}
        onOpenProjector={() => setIsProjectorMode(true)}
      />

      {/* Main Content Area with Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

        <main className="flex-1 overflow-y-auto p-6 bg-stone-50">
          {currentTab === 'dashboard' && (
            <DashboardView
              stats={stats}
              recentEvents={recentEvents}
              activeSession={activeSession}
              onRefresh={pollTelemetry}
            />
          )}

          {currentTab === 'analytics' && <AnalyticsView />}

          {currentTab === 'timetable' && <TimetableView />}

          {currentTab === 'attendance' && <AttendanceView />}

          {currentTab === 'students' && <StudentsView />}

          {currentTab === 'academic' && <AcademicYearView />}

          {currentTab === 'camera' && (
            <GateCameraSettings
              cameraHealth={stats?.camera_health}
              onRefresh={pollTelemetry}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
