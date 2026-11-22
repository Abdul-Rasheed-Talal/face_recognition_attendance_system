import React, { useState, useEffect } from 'react';
import {
  Users,
  UserCheck,
  Clock,
  TrendingUp,
  Camera,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  GraduationCap,
  CalendarDays,
  Sparkles,
} from 'lucide-react';
import { DashboardStatistics, LiveAttendanceEvent, LabSession } from '../types';
import { api } from '../services/api';

interface DashboardViewProps {
  stats: DashboardStatistics | null;
  recentEvents: LiveAttendanceEvent[];
  activeSession?: LabSession | null;
  onRefresh: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  stats,
  recentEvents,
  activeSession,
  onRefresh,
}) => {
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [streamKey, setStreamKey] = useState(Date.now());
  const [mode, setMode] = useState<'stream' | 'snapshot'>('stream');
  const [snapshotSrc, setSnapshotSrc] = useState<string>('');

  const camHealth = stats?.camera_health;
  const isCamConnected = camHealth?.camera_connected ?? false;

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await api.reconnectCamera();
      setStreamKey(Date.now());
      setStreamError(false);
      setTimeout(onRefresh, 1000);
    } catch (e) {
      console.error('Reconnect failed:', e);
    } finally {
      setIsReconnecting(false);
    }
  };

  // Snapshot polling fallback if stream fails or in snapshot mode
  useEffect(() => {
    if (mode !== 'snapshot' && !streamError) return;

    // Snapshot fallback polls at 2 s (0.5 FPS), not 250 ms: the old
    // 4 req/s per open dashboard was pure load on the edge box for a
    // fallback view. The live MJPEG stream is the primary feed.
    setSnapshotSrc(api.getCameraSnapshotUrl());
    const interval = setInterval(() => {
      setSnapshotSrc(api.getCameraSnapshotUrl());
    }, 2000);

    return () => clearInterval(interval);
  }, [mode, streamError]);

  const streamUrl = `${api.getCameraStreamUrl()}?k=${streamKey}`;
  const displaySrc = mode === 'snapshot' || streamError ? (snapshotSrc || api.getCameraSnapshotUrl()) : streamUrl;

  // Latest entry event (first in recent events)
  const latestEvent = recentEvents[0];

  return (
    <div className="space-y-6">
      {/* Top Banner: Instant Recognition Live Alert */}
      {latestEvent ? (
        <div
          className={`p-4 rounded-2xl border transition-all duration-300 shadow-xs flex items-center justify-between ${
            latestEvent.status === 'LATE'
              ? 'bg-amber-50/80 border-amber-200 text-amber-900'
              : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                latestEvent.status === 'LATE'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {latestEvent.status === 'LATE' ? (
                <Clock className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider">
                  {latestEvent.status === 'LATE' ? 'Late Arrival Marked' : 'Attendance Verified'}
                </span>
                <span className="text-[11px] opacity-75">
                  ({new Date(latestEvent.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                </span>
              </div>
              <div className="text-sm font-bold mt-0.5">
                {latestEvent.student_name}{' '}
                <span className="text-xs font-mono font-normal opacity-80">
                  [{latestEvent.roll_number}]
                </span>
                {latestEvent.class_name && (
                  <span className="text-xs font-normal opacity-75"> • {latestEvent.class_name}</span>
                )}
                {latestEvent.subject_name && (
                  <span className="text-xs font-normal opacity-75"> ({latestEvent.subject_name})</span>
                )}
              </div>
            </div>
          </div>

          <span
            className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
              latestEvent.status === 'LATE'
                ? 'bg-amber-200 text-amber-900'
                : 'bg-emerald-200 text-emerald-900'
            }`}
          >
            {latestEvent.status === 'LATE' ? 'LATE' : 'PRESENT'}
          </span>
        </div>
      ) : (
        <div className="p-3.5 rounded-2xl bg-white border border-stone-200 shadow-xs flex items-center justify-between text-xs text-stone-600">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-stone-400" />
            <span>Gate Camera is actively monitoring entrance. Student recognition triggers in &lt;0.5s.</span>
          </div>
          <span className="text-[11px] text-stone-400 font-mono">Camera: {camHealth?.camera_source ? String(camHealth.camera_source).split('@').pop() : 'Default'}</span>
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1: Total Enrolled */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold">Total Students</span>
            <Users className="w-4 h-4 text-stone-400" />
          </div>
          <div className="text-2xl font-bold text-stone-900 tracking-tight">
            {stats?.total_students ?? '--'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Registered in roster</div>
        </div>

        {/* Card 2: Present Today */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold">Present (On-Time)</span>
            <UserCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 tracking-tight">
            {stats?.present_today ?? '--'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Entered on schedule</div>
        </div>

        {/* Card 3: Late Arrivals */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold">Late Arrivals</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-600 tracking-tight">
            {stats?.late_today ?? '--'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Exceeded grace threshold</div>
        </div>

        {/* Card 4: Attendance Rate */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold">Attendance Rate</span>
            <TrendingUp className="w-4 h-4 text-stone-400" />
          </div>
          <div className="text-2xl font-bold text-stone-900 tracking-tight">
            {stats?.overall_attendance_pct != null ? `${stats.overall_attendance_pct}%` : '--'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Overall session turnout</div>
        </div>
      </div>

      {/* Main Grid: Live Gate Camera Stream & Recent Entries */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Live Camera Feed */}
        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs flex flex-col">
          <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-stone-50/60">
            <div className="flex items-center gap-2.5">
              <div className={`w-2.5 h-2.5 rounded-full ${isCamConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <h2 className="text-xs font-bold text-stone-900 tracking-wide uppercase">
                Gate Entrance Camera Feed
              </h2>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white text-stone-600 border border-stone-200">
                {mode === 'snapshot' || streamError ? 'Snapshot Fallback' : 'Live Stream'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setMode(mode === 'stream' ? 'snapshot' : 'stream')}
                className="text-[11px] text-stone-600 hover:text-stone-900 px-2 py-1 rounded bg-white border border-stone-200 transition"
              >
                {mode === 'stream' ? 'Switch to Snapshots' : 'Switch to Stream'}
              </button>
              <button
                onClick={handleReconnect}
                disabled={isReconnecting}
                className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-stone-100 text-stone-700 rounded-lg text-xs font-medium border border-stone-200 transition disabled:opacity-50 cursor-pointer"
                title="Restart camera stream connection"
              >
                <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`} />
                <span>Reconnect</span>
              </button>
            </div>
          </div>

          {/* Video Container */}
          <div className="relative bg-stone-900 aspect-video flex items-center justify-center overflow-hidden">
            <img
              key={streamKey}
              src={displaySrc}
              alt="Gate Camera Feed"
              onError={() => {
                if (mode === 'stream') {
                  setStreamError(true);
                }
              }}
              onLoad={() => {
                if (streamError) setStreamError(false);
              }}
              className="w-full h-full object-contain"
            />

            {/* Offline Overlay if Camera Disconnected */}
            {!isCamConnected && (
              <div className="absolute inset-0 bg-stone-900/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center text-white">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 mb-3">
                  <Camera className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold">Gate Camera Offline or Connecting</h3>
                <p className="text-xs text-stone-400 mt-1 max-w-sm">
                  {camHealth?.last_error || 'Checking RTSP connection to gate camera... If camera is disconnected, verify power and network IP in Camera Setup.'}
                </p>
                <button
                  onClick={handleReconnect}
                  disabled={isReconnecting}
                  className="mt-4 px-4 py-2 bg-white text-stone-900 hover:bg-stone-100 rounded-xl text-xs font-semibold transition"
                >
                  Retry Connection Now
                </button>
              </div>
            )}
          </div>

          {/* Feed Telemetry Footer */}
          <div className="p-3 border-t border-stone-200 bg-stone-50/50 flex items-center justify-between text-[11px] text-stone-500">
            <div className="flex items-center gap-3">
              <span>Status: <strong className={isCamConnected ? 'text-emerald-700' : 'text-rose-600'}>{isCamConnected ? 'Online' : 'Offline'}</strong></span>
              <span>•</span>
              <span>Inference FPS: <strong className="text-stone-700">{camHealth?.processing_fps || 10} FPS</strong></span>
            </div>
            <div className="text-stone-500">
              Face Recognition: <span className="text-stone-700 font-medium">YuNet + SFace (ONNX)</span>
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Active Slot & Recent Entries */}
        <div className="space-y-4 flex flex-col">
          {/* Active Timetable Slot Card */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between text-xs font-semibold text-stone-700 mb-2">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4 text-stone-500" />
                <span>Current Class Timetable Slot</span>
              </span>
              {activeSession && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  LIVE
                </span>
              )}
            </div>

            {activeSession ? (
              <div className="space-y-1.5 text-xs">
                <div className="font-bold text-sm text-stone-900">{activeSession.subject_name}</div>
                <div className="text-stone-600">
                  Class: <strong>{activeSession.class_name}</strong>
                </div>
                <div className="text-stone-500 flex items-center gap-2 text-[11px]">
                  <Clock className="w-3.5 h-3.5 text-stone-400" />
                  <span>
                    {new Date(activeSession.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                    {new Date(activeSession.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span>(Grace: {activeSession.late_grace_minutes}m)</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-stone-500 py-1">
                No active class slot running right now. Add slots in the <strong>Class Timetable</strong> tab.
              </div>
            )}
          </div>

          {/* Recent Live Entries Log */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden flex-1 flex flex-col">
            <div className="p-4 border-b border-stone-200 bg-stone-50/60 flex items-center justify-between">
              <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Recent Gate Entries Today
              </h3>
              <span className="text-[11px] text-stone-500">{recentEvents.length} recorded</span>
            </div>

            <div className="overflow-y-auto max-h-[380px] divide-y divide-stone-100 flex-1">
              {recentEvents.length === 0 ? (
                <div className="p-8 text-center text-xs text-stone-400">
                  No attendance entries yet today. Students entering from the gate will appear here automatically.
                </div>
              ) : (
                recentEvents.slice(0, 15).map((evt, idx) => (
                  <div key={idx} className="p-3 flex items-center justify-between hover:bg-stone-50/50 transition">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          evt.status === 'LATE'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {evt.status === 'LATE' ? (
                          <Clock className="w-3.5 h-3.5" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-stone-900 leading-tight">
                          {evt.student_name}
                        </div>
                        <div className="text-[11px] text-stone-500">
                          {evt.roll_number} {evt.class_name && `• ${evt.class_name}`}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          evt.status === 'LATE'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {evt.status === 'LATE' ? 'Late' : 'On-Time'}
                      </span>
                      <div className="text-[10px] text-stone-400 mt-0.5 font-mono">
                        {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
