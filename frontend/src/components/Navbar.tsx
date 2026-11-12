import React from 'react';
import { Camera, Radio, Shield, User, LogOut, LogIn } from 'lucide-react';
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

  return (
    <header className="h-16 bg-slate-800/90 border-b border-slate-700/80 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-40">
      {/* Brand & System Title */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Camera className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-white text-base tracking-tight">AI Lab Attendance</h1>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              CPU Edge
            </span>
          </div>
          <p className="text-xs text-slate-400">Computer Vision Doorway System</p>
        </div>
      </div>

      {/* Status & Live Indicators */}
      <div className="hidden md:flex items-center gap-3">
        {/* Active Session Pill */}
        {activeSession ? (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-700/70 border border-slate-600 text-xs text-slate-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium text-emerald-400">Active:</span>
            <span>{activeSession.subject_code} ({activeSession.room_number})</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-700/40 border border-slate-700 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            <span>No Active Session</span>
          </div>
        )}

        {/* Camera Status */}
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
          isCamConnected
            ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
            : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
        }`}>
          <Camera className="w-3.5 h-3.5" />
          <span>Camera {isCamConnected ? 'Online' : 'Offline'}</span>
          {cameraHealth && (
            <span className="text-[10px] opacity-75">({cameraHealth.ingestion_fps} FPS)</span>
          )}
        </div>

        {/* WebSocket Real-time Dot */}
        <div
          title={isWsConnected ? 'Real-time WebSocket Live' : 'WebSocket Disconnected'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
            isWsConnected
              ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300'
              : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${isWsConnected ? 'animate-pulse text-cyan-400' : 'text-amber-400'}`} />
          <span className="text-[11px] font-mono">{isWsConnected ? 'LIVE WS' : 'RECONNECTING'}</span>
        </div>
      </div>

      {/* User Actions */}
      <div className="flex items-center gap-3">
        {currentUser ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 pl-3 border-l border-slate-700">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-200 border border-slate-600">
                <User className="w-4 h-4" />
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-semibold text-slate-200">{currentUser.full_name}</div>
                <div className="flex items-center gap-1">
                  <Shield className="w-3 h-3 text-indigo-400" />
                  <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">
                    {currentUser.role}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-700/50 rounded-lg transition"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
          >
            <LogIn className="w-4 h-4" />
            <span>Teacher / Admin Login</span>
          </button>
        )}
      </div>
    </header>
  );
};
