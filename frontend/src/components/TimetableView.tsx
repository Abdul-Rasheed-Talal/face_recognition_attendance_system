import React, { useState, useEffect } from 'react';
import {
  CalendarDays,
  Plus,
  Clock,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Play,
  X,
  BookOpen,
  GraduationCap,
} from 'lucide-react';
import { LabSession } from '../types';
import { api, ClassItem } from '../services/api';

interface SubjectItem {
  id: string;
  department_id: string;
  code: string;
  name: string;
}

export const TimetableView: React.FC = () => {
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [laboratories, setLaboratories] = useState<{ id: string; name: string; room_number: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [laboratoryId, setLaboratoryId] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:30');
  const [graceMinutes, setGraceMinutes] = useState(15);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [sessList, classList, subjList, labList] = await Promise.all([
        api.listSessions().catch(() => []),
        api.listClasses().catch(() => []),
        api.listSubjects().catch(() => []),
        api.listLaboratories().catch(() => []),
      ]);
      setSessions(sessList);
      setClasses(classList);
      setSubjects(subjList);
      setLaboratories(labList);
      if (classList.length > 0 && !classId) setClassId(classList[0].id);
      if (subjList.length > 0 && !subjectId) setSubjectId(subjList[0].id);
      if (labList.length > 0 && !laboratoryId) setLaboratoryId(labList[0].id);
    } catch (e) {
      console.error('Error loading timetable data:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !subjectId) {
      setFormError('Please select both a class and a subject.');
      return;
    }
    if (!laboratoryId) {
      setFormError('No laboratory is configured. Create one first (the DAE CIT Laboratory is seeded on a fresh install).');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      // Build ISO UTC datetime for today's date with the chosen hours and minutes
      const today = new Date();
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);

      const startDt = new Date(today);
      startDt.setHours(startHour, startMin, 0, 0);

      const endDt = new Date(today);
      endDt.setHours(endHour, endMin, 0, 0);

      if (endDt <= startDt) {
        setFormError('End time must be after start time.');
        setIsSubmitting(false);
        return;
      }

      await api.createSession({
        subject_id: subjectId,
        laboratory_id: laboratoryId,
        class_id: classId,
        start_time: startDt.toISOString(),
        end_time: endDt.toISOString(),
        late_grace_minutes: Number(graceMinutes),
      });

      setIsModalOpen(false);
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create timetable slot.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Are you sure you want to remove this class slot from the timetable?')) return;
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleActivateSession = async (id: string) => {
    try {
      await api.updateSession(id, { status_update: 'ACTIVE' });
      await loadData();
    } catch (err) {
      console.error('Failed to activate session:', err);
    }
  };

  // Helper to format ISO time to friendly 12-hour AM/PM string
  const formatTime = (isoString: string) => {
    try {
      const dt = new Date(isoString);
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  // Determine period status
  const getSlotStatus = (session: LabSession) => {
    const now = new Date();
    const start = new Date(session.start_time);
    const end = new Date(session.end_time);

    if (session.status === 'COMPLETED' || now > end) {
      return { label: 'Completed', color: 'bg-stone-100 text-stone-600 border-stone-200' };
    }
    if (session.status === 'ACTIVE' || (now >= start && now <= end)) {
      return { label: 'Live Now', color: 'bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold' };
    }
    return { label: 'Upcoming', color: 'bg-stone-50 text-stone-700 border-stone-300' };
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Add Slot Button */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-stone-800" />
            <h2 className="text-lg font-bold text-stone-900 tracking-tight">Class Timetable & Schedule</h2>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Configure periods for different classes throughout the day. The entrance camera automatically detects students and marks attendance for their active class slot.
          </p>
        </div>

        <button
          onClick={() => {
            setFormError(null);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Class Slot</span>
        </button>
      </div>

      {/* Timetable Slots List */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-stone-200 bg-stone-50/60 flex items-center justify-between">
          <div className="text-xs font-semibold text-stone-700">Scheduled Periods Today</div>
          <span className="text-[11px] text-stone-500">{sessions.length} total classes configured</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-xs text-stone-400">Loading timetable schedule...</div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center">
            <Clock className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-stone-700">No Class Periods Scheduled Yet</h3>
            <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto">
              Add class periods to your timetable so students walking through the entrance gate are automatically recognized and marked present for their respective classes.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-4 px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-semibold hover:bg-stone-800 transition"
            >
              + Create First Class Slot
            </button>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {sessions.map((session) => {
              const statusInfo = getSlotStatus(session);
              return (
                <div
                  key={session.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-stone-50/50 transition"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-stone-100 border border-stone-200 flex flex-col items-center justify-center text-stone-800 shrink-0">
                      <Clock className="w-4 h-4 text-stone-600 mb-0.5" />
                      <span className="text-[10px] font-bold">{session.late_grace_minutes}m</span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-stone-900">{session.subject_name}</span>
                        <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                          {session.subject_code}
                        </span>
                        <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 mt-1.5 text-xs text-stone-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <GraduationCap className="w-3.5 h-3.5 text-stone-400" />
                          <strong className="text-stone-700">{session.class_name}</strong>
                        </span>
                        <span>•</span>
                        <span className="font-medium text-stone-800">
                          {formatTime(session.start_time)} - {formatTime(session.end_time)}
                        </span>
                        <span>•</span>
                        <span>Grace: {session.late_grace_minutes} mins (Late after that)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {session.status !== 'ACTIVE' && (
                      <button
                        onClick={() => handleActivateSession(session.id)}
                        title="Force Activate this session now"
                        className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-medium border border-stone-200 transition flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-3 h-3 text-stone-600" />
                        <span>Set Active</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteSession(session.id)}
                      title="Remove from timetable"
                      className="p-2 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Class Slot Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-800">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Add Class Timetable Slot</h3>
                <p className="text-xs text-stone-500">Configure class timing for automatic gate attendance</p>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSession} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Target Class / Section</label>
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.year} - {c.section})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-stone-500 mt-1">Students enrolled in this class will be marked for this slot.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Laboratory</label>
                <select
                  value={laboratoryId}
                  onChange={(e) => setLaboratoryId(e.target.value)}
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                >
                  {laboratories.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.room_number})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-stone-500 mt-1">The gate camera for this lab is what marks attendance.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Subject</label>
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">End Time</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Late Grace Threshold (Minutes)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={graceMinutes}
                    onChange={(e) => setGraceMinutes(Number(e.target.value))}
                    className="w-24 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                  <span className="text-xs text-stone-500">
                    Students entering within {graceMinutes} mins of start time are marked <strong>PRESENT</strong>; afterwards <strong>LATE</strong>.
                  </span>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Add Slot to Timetable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
