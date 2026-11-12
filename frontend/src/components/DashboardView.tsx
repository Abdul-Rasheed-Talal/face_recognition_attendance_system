import React from 'react';
import {
  Users,
  UserCheck,
  Clock,
  UserX,
  TrendingUp,
  Camera,
  RefreshCw,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import { DashboardStatistics, LiveAttendanceEvent } from '../types';
import { api } from '../services/api';
import { CameraConfigModal } from './CameraConfigModal';

interface DashboardViewProps {
  stats: DashboardStatistics | null;
  recentEvents: LiveAttendanceEvent[];
  onRefresh: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ stats, recentEvents, onRefresh }) => {
  const [isReconnecting, setIsReconnecting] = React.useState(false);
  const [streamError, setStreamError] = React.useState(false);
  const [streamKey, setStreamKey] = React.useState(Date.now());
  const [mode, setMode] = React.useState<'stream' | 'snapshot'>('stream');
  const [snapshotSrc, setSnapshotSrc] = React.useState<string>('');
  const [isConfigOpen, setIsConfigOpen] = React.useState(false);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await api.reconnectCamera();
      setStreamKey(Date.now());
      setStreamError(false);
      setTimeout(onRefresh, 1000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsReconnecting(false);
    }
  };

  // In snapshot fallback or snapshot mode, poll snapshot frames every 200ms
  React.useEffect(() => {
    if (mode !== 'snapshot' && !streamError) return;

    // Immediately fetch first snapshot
    setSnapshotSrc(api.getCameraSnapshotUrl());

    const interval = setInterval(() => {
      setSnapshotSrc(api.getCameraSnapshotUrl());
    }, 200);

    return () => clearInterval(interval);
  }, [mode, streamError]);

  const streamUrl = `${api.getCameraStreamUrl()}?k=${streamKey}`;
  const displaySrc = (mode === 'snapshot' || streamError) ? (snapshotSrc || api.getCameraSnapshotUrl()) : streamUrl;
  const camHealth = stats?.camera_health;

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Card 1: Total Enrolled */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Total Students</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">
            {stats?.total_students ?? '--'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Active enrollments</div>
        </div>

        {/* Card 2: Present Today */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Present Today</span>
            <UserCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 tracking-tight">
            {stats?.present_today ?? '--'}
          </div>
          <div className="text-[11px] text-emerald-500/80 mt-1">Verified at entrance</div>
        </div>

        {/* Card 3: Late Today */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Late Arrivals</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 tracking-tight">
            {stats?.late_today ?? '--'}
          </div>
          <div className="text-[11px] text-amber-500/80 mt-1">After 15m grace period</div>
        </div>

        {/* Card 4: Absent */}
        <div className="bg-slate-800/80 border border-slate-700/70 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Absent</span>
            <UserX className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-400 tracking-tight">
            {stats?.absent_today ?? '--'}
          </div>
          <div className="text-[11px] text-rose-500/80 mt-1">Not detected in lab</div>
        </div>

        {/* Card 5: Attendance Rate */}
        <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-indigo-900/40 to-slate-800/80 border border-indigo-700/40 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-indigo-300 mb-2">
            <span className="text-xs font-medium">Attendance Rate</span>
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-cyan-300 tracking-tight">
            {stats?.overall_attendance_pct != null ? `${stats.overall_attendance_pct}%` : '--'}
          </div>
          <div className="text-[11px] text-indigo-300/80 mt-1">Overall session turnout</div>
        </div>
      </div>

      {/* Main Grid: Live Camera Monitor & Real-time Live Event Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Live Camera Feed */}
        <div className="lg:col-span-2 bg-slate-800/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-lg flex flex-col">
          <div className="p-4 border-b border-slate-700/80 flex items-center justify-between bg-slate-800/60">
            <div className="flex items-center gap-2.5">
              <div className={`w-3 h-3 rounded-full ${camHealth?.camera_connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <h2 className="text-sm font-bold text-white tracking-wide">
                Entrance Camera: Live Recognition Overlay
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-700/80 text-slate-300 border border-slate-600/50 uppercase">
                {mode === 'snapshot' || streamError ? 'Live Snapshots' : 'Live Stream'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (mode === 'stream' && !streamError) {
                    setMode('snapshot');
                  } else {
                    setMode('stream');
                    setStreamError(false);
                    setStreamKey(Date.now());
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-700/90 hover:bg-slate-600 text-xs font-medium text-slate-300 rounded-lg transition border border-slate-600/40"
                title="Toggle stream protocol between MJPEG and Snapshot polling"
              >
                {mode === 'snapshot' || streamError ? 'Use MJPEG Stream' : 'Use Snapshot Mode'}
              </button>
              <button
                onClick={handleReconnect}
                disabled={isReconnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-200 rounded-lg transition disabled:opacity-50"
                title="Restart RTSP Ingestion Pipeline"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
                <span>{isReconnecting ? 'Reconnecting...' : 'Reconnect Camera'}</span>
              </button>
              <button
                onClick={() => setIsConfigOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white rounded-lg transition shadow-sm"
                title="Configure Camera Source or Hikvision RTSP Credentials"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Camera Settings</span>
              </button>
            </div>
          </div>

          {/* Video Stream Container */}
          <div className="relative bg-slate-950 flex-1 min-h-[380px] flex items-center justify-center overflow-hidden">
            <img
              key={mode === 'stream' && !streamError ? streamKey : undefined}
              src={displaySrc}
              alt="Live Entrance Recognition Feed"
              className="w-full h-full object-contain max-h-[500px]"
              onError={() => {
                console.warn('Live camera stream encountered a loading issue. Falling back to live snapshots.');
                setStreamError(true);
              }}
              onLoad={() => {
                if (streamError && mode === 'stream') {
                  setStreamError(false);
                }
              }}
            />
            {/* Fallback if camera stream is disconnected or pending */}
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center pointer-events-none -z-10">
              <Camera className="w-12 h-12 text-slate-600 mb-3" />
              <div className="text-sm font-semibold text-slate-400">Camera Feed Ingestion Active</div>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                Processing incoming RTSP frames at 3.3 FPS on Intel Core i5 CPU. Line crossing & faces will annotate automatically.
              </p>
            </div>

            {/* In-Video Live Diagnostics HUD */}
            {camHealth && (
              <div className="absolute top-3 left-3 bg-slate-900/85 backdrop-blur border border-slate-700/80 rounded-xl px-3 py-2 text-[11px] font-mono text-slate-300 space-y-0.5 shadow-md">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Ingest FPS:</span>
                  <span className="text-emerald-400 font-bold">{camHealth.ingestion_fps} FPS</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Latency:</span>
                  <span className="text-cyan-400">{camHealth.pipeline_latency_ms} ms</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Active Tracks:</span>
                  <span className="text-indigo-400">{camHealth.active_tracks_count}</span>
                </div>
              </div>
            )}
          </div>

          {/* Camera Telemetry Bar */}
          <div className="px-4 py-3 bg-slate-800/80 border-t border-slate-700/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-4">
              <span>Source: <strong className="text-slate-200">{camHealth?.camera_source ?? '0'}</strong></span>
              <span>Enrolled Gallery: <strong className="text-indigo-400">{camHealth?.enrolled_students_in_gallery ?? 0} students</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-300">YuNet + SFace Engine Running</span>
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Real-Time Live Attendance Events Feed */}
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl flex flex-col shadow-lg overflow-hidden">
          <div className="p-4 border-b border-slate-700/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Live Attendance Stream</h3>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Instant WS
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-3 max-h-[440px]">
            {recentEvents.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs">Waiting for student entry events...</p>
                <p className="text-[11px] text-slate-400 mt-1">Verified entrances will pop up here live.</p>
              </div>
            ) : (
              recentEvents.map((evt, idx) => (
                <div
                  key={evt.record_id || idx}
                  className="p-3 rounded-xl bg-slate-900/80 border border-slate-700/70 hover:border-slate-600 transition flex items-start justify-between"
                >
                  <div>
                    <div className="text-xs font-bold text-white">{evt.student_name}</div>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">{evt.roll_number}</div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      evt.status === 'PRESENT'
                        ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-400'
                        : 'bg-amber-950/60 border border-amber-800 text-amber-400'
                    }`}>
                      {evt.status}
                    </span>
                    <div className="text-[10px] text-cyan-400 font-mono mt-1">
                      Match: {(evt.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Camera Configuration & RTSP Modal */}
      <CameraConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onConfigApplied={() => {
          setStreamKey(Date.now());
          setStreamError(false);
          setTimeout(onRefresh, 1000);
        }}
        currentSource={camHealth?.camera_source}
      />
    </div>
  );
};

