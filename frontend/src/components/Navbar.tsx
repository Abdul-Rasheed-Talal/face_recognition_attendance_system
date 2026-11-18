import React, { useState, useEffect } from 'react';
import { Camera, Radio, Shield, User, LogOut, LogIn, Clock } from 'lucide-react';
import { User as UserType, LabSession, CameraHealth } from '../types';

interface NavbarProps {
  currentUser: UserType | null;
  activeSession: LabSession | null;
  cameraHealth?: CameraHealth;
  isWsConnected: boolean;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeSession,
  cameraHealth,
  isWsConnected,
  onOpenLogin,
  onLogout,
}) => {
  const isCamConnected = cameraHealth?.camera_connected ?? false;
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
          <Camera className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-stone-900 text-base tracking-tight">Gate Attendance System</h1>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
              Live Gate Camera
            </span>
          </div>
          <p className="text-xs text-stone-500">Autonomous Entrance Face Recognition</p>
        </div>
      </div>

      {/* Status & Live Indicators */}
      <div className="hidden md:flex items-center gap-3">
        {/* Live Clock */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-xs font-mono font-medium border border-stone-200">
          <Clock className="w-3.5 h-3.5 text-stone-500" />
          <span>{currentTime || '--:--:--'}</span>
        </div>

        {/* Active Class Timetable Slot */}
        {activeSession ? (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-emerald-900">Current Slot:</span>
            <span>{activeSession.subject_code} - {activeSession.class_name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-xs text-stone-500">
            <span className="w-2 h-2 rounded-full bg-stone-400" />
            <span>No Active Class Slot</span>
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

        {/* Live Connection Pulse */}
        <div
          title={isWsConnected ? 'System connected live' : 'Connecting...'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
            isWsConnected
              ? 'bg-stone-100 border-stone-200 text-stone-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${isWsConnected ? 'text-emerald-600' : 'text-amber-500 animate-pulse'}`} />
          <span className="text-[11px] font-medium">{isWsConnected ? 'LIVE FEED' : 'CONNECTING'}</span>
        </div>
      </div>

      {/* User Actions */}
      <div className="flex items-center gap-3">
        {currentUser ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 pl-3 border-l border-stone-200">
              <div className="w-8 h-8 rounded-full bg-stone-100 border border-stone-300 flex items-center justify-center text-stone-700">
                <User className="w-4 h-4" />
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-semibold text-stone-900">{currentUser.full_name}</div>
                <div className="flex items-center gap-1">
                  <Shield className="w-3 h-3 text-stone-500" />
                  <span className="text-[10px] uppercase font-bold text-stone-500 tracking-wider">
                    {currentUser.role}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <LogIn className="w-4 h-4" />
            <span>Staff Login</span>
          </button>
        )}
      </div>
    </header>
  );
};

