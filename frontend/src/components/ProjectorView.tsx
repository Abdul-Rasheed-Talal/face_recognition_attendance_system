import React, { useState, useEffect, useCallback } from 'react';
import {
  Monitor,
  Clock,
  CheckCircle2,
  XCircle,
  UserCheck,
  MapPin,
  Maximize2,
  Minimize2,
  ArrowLeft,
  CalendarDays,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { LiveAttendanceEvent } from '../types';

interface ProjectorViewProps {
  onExitProjector?: () => void;
}

export const ProjectorView: React.FC<ProjectorViewProps> = ({ onExitProjector }) => {
  const [data, setData] = useState<any>(null);
  const [liveClock, setLiveClock] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [flashEvent, setFlashEvent] = useState<LiveAttendanceEvent | null>(null);

  // Live 12-hour digital clock
  useEffect(() => {
    const tick = () => {
      setLiveClock(
        new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const fetchLive = useCallback(async () => {
    try {
      const res = await api.getProjectorLiveData();
      setData(res);
    } catch (e) {
      console.debug('Projector poll error:', e);
    }
  }, []);

  // Poll every 5 seconds to auto-switch when the lecture changes
  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 5000);
    return () => clearInterval(interval);
  }, [fetchLive]);

  // Real-time WebSocket update: immediately refresh & flash student welcome banner
  const handleWsEvent = useCallback(
    (evt: LiveAttendanceEvent) => {
      if (evt.type === 'ATTENDANCE_RECORDED') {
        setFlashEvent(evt);
        fetchLive();
        setTimeout(() => setFlashEvent(null), 6000);
      }
    },
    [fetchLive]
  );

  const { isConnected } = useWebSocket(handleWsEvent);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const current = data?.current_lecture;
  const next = data?.next_lecture;
  const schedule = data?.today_schedule || [];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      {/* Top Projector Header Bar */}
      <header className="bg-white border-b border-stone-200 px-8 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-stone-900 text-white flex items-center justify-center shadow-xs">
            <Monitor className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-extrabold tracking-tight text-stone-900">
                CIT Department — Live Lab Attendance
              </h1>
              <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-stone-100 text-stone-700 border border-stone-200 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-stone-500" />
                {data?.room_name || 'Computer Lab-1'}
              </span>
            </div>
            <p className="text-sm text-stone-500 mt-0.5 font-medium">
              {data?.today_date_label || new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Live Status & Big 12h Clock */}
          <div className="flex items-center gap-3 bg-stone-100 border border-stone-200 px-5 py-2.5 rounded-2xl">
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-2xl font-black font-mono tracking-tight text-stone-900">
              {liveClock}
            </span>
          </div>

          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen for Projector"
            className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 transition cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>

          {onExitProjector && (
            <button
              onClick={onExitProjector}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Dashboard</span>
            </button>
          )}
        </div>
      </header>

      {/* Instant Live Arrival Flash Toast */}
      {flashEvent && (
        <div
          className={`mx-8 mt-4 px-6 py-4 rounded-2xl border-2 flex items-center justify-between shadow-md transition-all ${
            flashEvent.status === 'LATE'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 shrink-0" />
            <div className="text-lg font-bold">
              {flashEvent.student_name}{' '}
              <span className="font-mono text-base font-semibold opacity-75">({flashEvent.roll_number})</span>
              {' — '}Marked {flashEvent.status === 'LATE' ? 'LATE' : 'PRESENT'}!
            </div>
          </div>
          <span className="text-sm font-mono font-bold">
            {new Date(flashEvent.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
          </span>
        </div>
      )}

      {/* Main Projector Body */}
      <main className="flex-1 p-8 flex flex-col gap-6">
        {current ? (
          <>
            {/* Current Lecture Info Hero + Big KPI Counters */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              {/* Lecture Details Card */}
              <div className="xl:col-span-6 bg-white border border-stone-200 rounded-3xl p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                      Current Lecture Live
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-stone-900 text-white">
                      {current.class_name}
                    </span>
                  </div>

                  <h2 className="text-3xl font-black text-stone-900 tracking-tight mt-1">
                    {current.subject_name}
                  </h2>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-base text-stone-600 font-medium">
                    <span className="flex items-center gap-2">
                      <UserCheck className="w-5 h-5 text-stone-400" />
                      Teacher: <strong className="text-stone-900">{current.teacher_name || 'Lab Instructor'}</strong>
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-stone-400" />
                      Room: <strong className="text-stone-900">{current.room_name}</strong>
                    </span>
                    <span className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-stone-400" />
                      <strong className="text-stone-900 font-mono">{current.time_12h}</strong>
                    </span>
                  </div>
                </div>

                {/* Lecture Progress Bar */}
                <div className="mt-5">
                  <div className="flex justify-between text-xs font-semibold text-stone-500 mb-1">
                    <span>Lecture Progress</span>
                    <span>{current.progress_pct}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden border border-stone-200">
                    <div
                      style={{ width: `${current.progress_pct}%` }}
                      className="h-full bg-stone-800 rounded-full transition-all duration-500"
                    />
                  </div>
                </div>
              </div>

              {/* Big High-Contrast Attendance Counters */}
              <div className="xl:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-emerald-700">
                    <span className="text-sm font-bold uppercase tracking-wider">Present</span>
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div className="text-5xl font-black text-emerald-800 mt-2">{current.present_count}</div>
                  <div className="text-xs text-emerald-700/80 font-medium mt-1">On-Time in Lab</div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-amber-700">
                    <span className="text-sm font-bold uppercase tracking-wider">Late</span>
                    <Clock className="w-6 h-6 text-amber-600" />
                  </div>
                  <div className="text-5xl font-black text-amber-800 mt-2">{current.late_count}</div>
                  <div className="text-xs text-amber-700/80 font-medium mt-1">After {current.late_grace_minutes}m Grace</div>
                </div>

                <div className="bg-rose-50 border border-rose-200 rounded-3xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-rose-700">
                    <span className="text-sm font-bold uppercase tracking-wider">Absent</span>
                    <XCircle className="w-6 h-6 text-rose-600" />
                  </div>
                  <div className="text-5xl font-black text-rose-800 mt-2">{current.absent_count}</div>
                  <div className="text-xs text-rose-700/80 font-medium mt-1">Not Yet Entered</div>
                </div>

                <div className="bg-stone-900 text-white rounded-3xl p-5 flex flex-col justify-between">
                  <span className="text-sm font-bold uppercase tracking-wider text-stone-300">Turnout</span>
                  <div className="text-4xl font-black mt-2">{current.attendance_pct}%</div>
                  <div className="text-xs text-stone-400 font-medium mt-1">
                    {current.present_count + current.late_count} of {current.total_students} Students
                  </div>
                </div>
              </div>
            </div>

            {/* 3-Column Live Roster Board: Present | Late | Absent */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
              {/* Column 1: PRESENT STUDENTS */}
              <div className="bg-white border border-stone-200 rounded-3xl shadow-xs overflow-hidden flex flex-col">
                <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-emerald-900">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-base font-extrabold uppercase tracking-wide">Present Students</h3>
                  </div>
                  <span className="px-3 py-0.5 rounded-full bg-emerald-200 text-emerald-900 text-sm font-black">
                    {current.present_count}
                  </span>
                </div>
                <div className="p-4 overflow-y-auto max-h-[420px] space-y-2">
                  {current.present_students.length === 0 ? (
                    <div className="py-12 text-center text-sm text-stone-400">Waiting for students to enter...</div>
                  ) : (
                    current.present_students.map((st: any) => (
                      <div key={st.student_id} className="px-4 py-2.5 rounded-xl bg-emerald-50/40 border border-emerald-100 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-stone-900">{st.full_name}</div>
                          <div className="text-xs font-mono text-stone-500">{st.roll_number}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-mono font-bold text-emerald-700">{st.entry_time_12h}</div>
                          {st.verification_method === 'CARRIED_FORWARD' && (
                            <span className="text-[10px] font-semibold text-emerald-600">Carried Forward</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Column 2: LATE STUDENTS */}
              <div className="bg-white border border-stone-200 rounded-3xl shadow-xs overflow-hidden flex flex-col">
                <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-amber-900">
                    <Clock className="w-5 h-5 text-amber-600" />
                    <h3 className="text-base font-extrabold uppercase tracking-wide">Late Arrivals</h3>
                  </div>
                  <span className="px-3 py-0.5 rounded-full bg-amber-200 text-amber-900 text-sm font-black">
                    {current.late_count}
                  </span>
                </div>
                <div className="p-4 overflow-y-auto max-h-[420px] space-y-2">
                  {current.late_students.length === 0 ? (
                    <div className="py-12 text-center text-sm text-stone-400">No late students so far</div>
                  ) : (
                    current.late_students.map((st: any) => (
                      <div key={st.student_id} className="px-4 py-2.5 rounded-xl bg-amber-50/60 border border-amber-200/70 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-stone-900">{st.full_name}</div>
                          <div className="text-xs font-mono text-stone-500">{st.roll_number}</div>
                        </div>
                        <span className="text-xs font-mono font-bold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-lg">
                          {st.entry_time_12h}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Column 3: ABSENT STUDENTS */}
              <div className="bg-white border border-stone-200 rounded-3xl shadow-xs overflow-hidden flex flex-col">
                <div className="px-6 py-4 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-rose-900">
                    <XCircle className="w-5 h-5 text-rose-600" />
                    <h3 className="text-base font-extrabold uppercase tracking-wide">Absent Students</h3>
                  </div>
                  <span className="px-3 py-0.5 rounded-full bg-rose-200 text-rose-900 text-sm font-black">
                    {current.absent_count}
                  </span>
                </div>
                <div className="p-4 overflow-y-auto max-h-[420px] space-y-2">
                  {current.absent_students.length === 0 ? (
                    <div className="py-12 text-center text-sm text-emerald-600 font-bold">100% Attendance — Everyone is Present!</div>
                  ) : (
                    current.absent_students.map((st: any) => (
                      <div key={st.student_id} className="px-4 py-2.5 rounded-xl bg-rose-50/40 border border-rose-100 flex items-center justify-between">
                        <div className="text-sm font-bold text-stone-900">{st.full_name}</div>
                        <div className="text-xs font-mono font-semibold text-rose-700">{st.roll_number}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Between Classes / Break / Before First Lecture Screen */
          <div className="flex-1 flex flex-col items-center justify-center bg-white border border-stone-200 rounded-3xl p-12 text-center shadow-xs">
            <div className="w-20 h-20 rounded-3xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-700 mb-5">
              <CalendarDays className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-black text-stone-900">No Lab Lecture Currently in Session</h2>
            <p className="text-base text-stone-500 mt-2 max-w-xl">
              This display automatically switches to the next Computer Lab-1 lecture as soon as it starts.
            </p>

            {next && (
              <div className="mt-8 p-6 rounded-2xl bg-stone-50 border border-stone-200 max-w-lg w-full text-left">
                <div className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">Up Next in Computer Lab-1</div>
                <div className="text-2xl font-extrabold text-stone-900">{next.subject_name}</div>
                <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-stone-600 font-medium">
                  <span className="px-2.5 py-0.5 rounded-full bg-stone-900 text-white text-xs font-bold">{next.class_name}</span>
                  <span>Teacher: <strong className="text-stone-900">{next.teacher_name || 'Lab Instructor'}</strong></span>
                  <span className="font-mono font-bold text-stone-900">{next.time_12h}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Today's Computer Lab-1 Schedule Strip */}
      <footer className="bg-white border-t border-stone-200 px-8 py-3.5">
        <div className="flex items-center gap-3 overflow-x-auto">
          <span className="text-xs font-extrabold uppercase tracking-wider text-stone-500 shrink-0">
            Today's Lab-1 Schedule:
          </span>
          {schedule.length === 0 ? (
            <span className="text-xs text-stone-400">No Computer Lab-1 lectures scheduled today</span>
          ) : (
            schedule.map((item: any) => (
              <div
                key={item.session_id}
                className={`px-3.5 py-1.5 rounded-xl border text-xs flex items-center gap-2 shrink-0 ${
                  item.state === 'LIVE'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-bold'
                    : item.state === 'CANCELLED'
                    ? 'bg-rose-50 border-rose-200 text-rose-600 line-through'
                    : item.state === 'COMPLETED'
                    ? 'bg-stone-100 border-stone-200 text-stone-400'
                    : 'bg-stone-50 border-stone-200 text-stone-700'
                }`}
              >
                <span className="font-mono font-semibold">{item.time_12h}</span>
                <span>•</span>
                <span>{item.class_name}</span>
                <span className="opacity-75">({item.subject_name})</span>
              </div>
            ))
          )}
        </div>
      </footer>
    </div>
  );
};
