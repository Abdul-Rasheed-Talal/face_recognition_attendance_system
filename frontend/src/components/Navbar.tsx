import React, { useState, useEffect } from 'react';
import { Camera, Radio, Clock, Monitor } from 'lucide-react';
import { LabSession, CameraHealth } from '../types';

interface NavbarProps {
  activeSession: LabSession | null;
  cameraHealth?: CameraHealth;
  isWsConnected: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeSession,
  cameraHealth,
  isWsConnected,
}) => {
  const isCamConnected = cameraHealth?.camera_connected ?? false;
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
      );
      setCurrentDate(
        now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="h-16 bg-white border-b border-stone-200 px-6 flex items-center justify-between sticky top-0 z-40 shadow-xs">
      {/* Brand & System Title */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-stone-900 flex items-center justify-center text-white shadow-xs">
          <Monitor className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-stone-900 text-base tracking-tight">CIT Computer Lab Attendance</h1>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
              CIT 1st · 2nd · 3rd Year
            </span>
          </div>
          <p className="text-xs text-stone-500">Automated Face Recognition Lab Gate System</p>
        </div>
      </div>

      {/* Live Status Indicators */}
      <div className="hidden md:flex items-center gap-3">
        {/* Live Date & Clock */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-xs font-mono font-medium border border-stone-200">
          <Clock className="w-3.5 h-3.5 text-stone-500" />
          <span>{currentDate} · {currentTime || '--:--:--'}</span>
        </div>

        {/* Active Lab Timetable Slot */}
        {activeSession ? (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-emerald-900">In Lab:</span>
            <span>{activeSession.class_name} — {activeSession.subject_name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-xs text-stone-500">
            <span className="w-2 h-2 rounded-full bg-stone-400" />
            <span>No Lab Class Active</span>
          </div>
        )}

        {/* Gate Camera Status */}
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
          isCamConnected
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          <Camera className="w-3.5 h-3.5" />
          <span>Camera {isCamConnected ? 'Online' : 'Offline'}</span>
          {cameraHealth && isCamConnected && (
            <span className="text-[10px] opacity-75 font-mono">({cameraHealth.ingestion_fps} FPS)</span>
          )}
        </div>

        {/* Live WebSocket Pulse */}
        <div
          title={isWsConnected ? 'Real-time updates active' : 'Reconnecting...'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
            isWsConnected
              ? 'bg-stone-100 border-stone-200 text-stone-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${isWsConnected ? 'text-emerald-600' : 'text-amber-500 animate-pulse'}`} />
          <span className="text-[11px] font-medium">{isWsConnected ? 'LIVE' : 'CONNECTING'}</span>
        </div>
      </div>
    </header>
  );
};
