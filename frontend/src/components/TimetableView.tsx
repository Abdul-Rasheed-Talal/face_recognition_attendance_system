import React, { useState, useEffect } from 'react';
import {
  CalendarDays,
  Plus,
  Clock,
  Trash2,
  AlertCircle,
  X,
  GraduationCap,
  CalendarClock,
  Ban,
  RotateCcw,
  Pencil,
  UserCheck,
  CheckCircle2,
} from 'lucide-react';
import { TimetableSlot, DailySession } from '../types';
import { api, ClassItem } from '../services/api';

const DAYS = [
  { id: 0, name: 'Monday' },
  { id: 1, name: 'Tuesday' },
  { id: 2, name: 'Wednesday' },
  { id: 3, name: 'Thursday' },
  { id: 4, name: 'Friday' },
  { id: 5, name: 'Saturday' },
];

const format12h = (hhmm?: string | null): string => {
  if (!hhmm || !hhmm.includes(':')) return hhmm || '';
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = mRaw.padStart(2, '0');
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
};

export const TimetableView: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'today' | 'weekly'>('today');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [dailySessions, setDailySessions] = useState<DailySession[]>([]);
  const [weeklySlots, setWeeklySlots] = useState<TimetableSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [filterClassId, setFilterClassId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Weekly Slot Modal (Add / Edit)
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimetableSlot | null>(null);
  const [slotDay, setSlotDay] = useState<number>(new Date().getDay() === 0 ? 0 : new Date().getDay() - 1);
  const [slotClassId, setSlotClassId] = useState('');
  const [slotSubject, setSlotSubject] = useState('');
  const [slotTeacher, setSlotTeacher] = useState('');
  const [slotStart, setSlotStart] = useState('08:30');
  const [slotEnd, setSlotEnd] = useState('10:00');
  const [slotGrace, setSlotGrace] = useState(15);

  // Extra One-Off Lab Session Modal
  const [isExtraModalOpen, setIsExtraModalOpen] = useState(false);
  const [extraClassId, setExtraClassId] = useState('');
  const [extraSubject, setExtraSubject] = useState('');
  const [extraTeacher, setExtraTeacher] = useState('');
  const [extraStart, setExtraStart] = useState('10:00');
  const [extraEnd, setExtraEnd] = useState('11:30');
  const [extraGrace, setExtraGrace] = useState(15);
  const [extraNote, setExtraNote] = useState('Makeup / Extra Computer Lab Class');

  // Reschedule Modal (when teacher is absent or class time shifts)
  const [reschedulingSession, setReschedulingSession] = useState<DailySession | null>(null);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedStart, setReschedStart] = useState('');
  const [reschedEnd, setReschedEnd] = useState('');
  const [reschedTeacher, setReschedTeacher] = useState('');
  const [reschedReason, setReschedReason] = useState('Teacher absent — rescheduled lab timing');

  // Cancel Modal (Teacher Absent)
  const [cancellingSession, setCancellingSession] = useState<DailySession | null>(null);
  const [cancelReason, setCancelReason] = useState('Teacher absent — lab class cancelled');

  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const showBanner = (type: 'success' | 'error', text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 4000);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [clsList, todayList, slotList] = await Promise.all([
        api.listClasses().catch(() => []),
        api.getDailySchedule(selectedDate).catch(() => []),
        api.listTimetableSlots().catch(() => []),
      ]);
      setClasses(clsList);
      setDailySessions(todayList);
      setWeeklySlots(slotList);
      if (clsList.length > 0) {
        if (!slotClassId) setSlotClassId(clsList[0].id);
        if (!extraClassId) setExtraClassId(clsList[0].id);
      }
    } catch (e) {
      console.error('Failed loading timetable:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  // --- Weekly Slot Handlers ---
  const openAddSlotModal = (defaultDay?: number) => {
    setEditingSlot(null);
    setSlotDay(defaultDay !== undefined ? defaultDay : (new Date().getDay() === 0 ? 0 : new Date().getDay() - 1));
    setSlotClassId(classes[0]?.id || '');
    setSlotSubject('');
    setSlotTeacher('');
    setSlotStart('08:30');
    setSlotEnd('10:00');
    setSlotGrace(15);
    setModalError(null);
    setIsSlotModalOpen(true);
  };

  const openEditSlotModal = (slot: TimetableSlot) => {
    setEditingSlot(slot);
    setSlotDay(slot.day_of_week);
    setSlotClassId(slot.class_id);
    setSlotSubject(slot.subject_name);
    setSlotTeacher(slot.teacher_name);
    setSlotStart(slot.start_time_str);
    setSlotEnd(slot.end_time_str);
    setSlotGrace(slot.late_grace_minutes);
    setModalError(null);
    setIsSlotModalOpen(true);
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setIsSaving(true);
    try {
      if (editingSlot) {
        await api.updateTimetableSlot(editingSlot.id, {
          day_of_week: slotDay,
          class_id: slotClassId,
          subject_name: slotSubject.trim(),
          teacher_name: slotTeacher.trim(),
          start_time_str: slotStart,
          end_time_str: slotEnd,
          late_grace_minutes: Number(slotGrace),
        });
        showBanner('success', 'Weekly lab timetable slot updated.');
      } else {
        await api.createTimetableSlot({
          day_of_week: slotDay,
          class_id: slotClassId,
          subject_name: slotSubject.trim(),
          teacher_name: slotTeacher.trim(),
          start_time_str: slotStart,
          end_time_str: slotEnd,
          late_grace_minutes: Number(slotGrace),
        });
        showBanner('success', 'Added new lab slot to the weekly timetable.');
      }
      setIsSlotModalOpen(false);
      await loadData();
    } catch (err: any) {
      setModalError(err.message || 'Could not save timetable slot.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSlot = async (slot: TimetableSlot) => {
    if (!window.confirm(`Remove "${slot.subject_name}" (${slot.class_name} on ${slot.day_name}) from the weekly timetable?`)) return;
    try {
      await api.deleteTimetableSlot(slot.id);
      showBanner('success', 'Weekly timetable slot removed.');
      await loadData();
    } catch (err: any) {
      showBanner('error', err.message || 'Failed to delete slot.');
    }
  };

  // --- Daily Session Handlers (Extra / Reschedule / Cancel / Restore) ---
  const handleCreateExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setIsSaving(true);
    try {
      await api.createExtraSession({
        target_date: selectedDate,
        class_id: extraClassId,
        subject_name: extraSubject.trim(),
        teacher_name: extraTeacher.trim(),
        start_time_str: extraStart,
        end_time_str: extraEnd,
        late_grace_minutes: Number(extraGrace),
        status_note: extraNote.trim() || 'Extra Lab Class',
      });
      setIsExtraModalOpen(false);
      setExtraSubject('');
      setExtraTeacher('');
      showBanner('success', 'Extra / makeup lab class scheduled for this day.');
      await loadData();
    } catch (err: any) {
      setModalError(err.message || 'Failed to add extra lab class.');
    } finally {
      setIsSaving(false);
    }
  };

  const openRescheduleModal = (s: DailySession) => {
    setReschedulingSession(s);
    setReschedDate(selectedDate);
    setReschedStart(s.start_time_local);
    setReschedEnd(s.end_time_local);
    setReschedTeacher(s.teacher_name || '');
    setReschedReason('Teacher absent — rescheduled lab class');
    setModalError(null);
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedulingSession) return;
    setModalError(null);
    setIsSaving(true);
    try {
      await api.rescheduleSession(reschedulingSession.id, {
        target_date: reschedDate,
        start_time_str: reschedStart,
        end_time_str: reschedEnd,
        teacher_name: reschedTeacher.trim(),
        reason: reschedReason.trim() || 'Rescheduled',
      });
      setReschedulingSession(null);
      showBanner('success', 'Lab class rescheduled. Camera will mark attendance at the new time.');
      await loadData();
    } catch (err: any) {
      setModalError(err.message || 'Failed to reschedule class.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingSession) return;
    setIsSaving(true);
    try {
      await api.cancelSession(cancellingSession.id, cancelReason.trim() || 'Teacher absent — cancelled');
      setCancellingSession(null);
      showBanner('success', 'Lab class marked as Cancelled (camera will not record attendance for it).');
      await loadData();
    } catch (err: any) {
      showBanner('error', err.message || 'Failed to cancel class.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreSession = async (s: DailySession) => {
    try {
      await api.restoreSession(s.id);
      showBanner('success', `"${s.subject_name}" restored to scheduled status.`);
      await loadData();
    } catch (err: any) {
      showBanner('error', err.message || 'Failed to restore session.');
    }
  };

  const getStatusBadge = (s: DailySession) => {
    if (s.status === 'CANCELLED') {
      return { label: 'Cancelled (Teacher Absent)', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
    }
    if (s.is_live_now) {
      return { label: s.status === 'RESCHEDULED' ? 'Live Now (Rescheduled)' : 'Live Now', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold' };
    }
    if (s.status === 'RESCHEDULED') {
      return { label: 'Rescheduled', cls: 'bg-amber-50 text-amber-800 border-amber-200 font-semibold' };
    }
    if (s.status === 'COMPLETED' || new Date(s.end_time) < new Date()) {
      return { label: 'Completed', cls: 'bg-stone-100 text-stone-500 border-stone-200' };
    }
    return { label: 'Scheduled', cls: 'bg-stone-50 text-stone-700 border-stone-200' };
  };

  const filteredWeeklySlots = filterClassId
    ? weeklySlots.filter((sl) => sl.class_id === filterClassId)
    : weeklySlots;

  return (
    <div className="space-y-6">
      {/* Feedback Banner */}
      {banner && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between shadow-xs ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span>{banner.text}</span>
          </div>
          <button onClick={() => setBanner(null)} className="p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header & Sub-Tab Switcher */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-stone-800" />
            <h2 className="text-lg font-bold text-stone-900 tracking-tight">CIT Computer Lab Timetable</h2>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Manage weekly Computer Lab classes for CIT 1st, 2nd &amp; 3rd Year. Easily reschedule or cancel any class if a teacher is absent.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-stone-100 p-1 rounded-xl border border-stone-200 self-start">
          <button
            onClick={() => setActiveSubTab('today')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeSubTab === 'today'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Daily Schedule &amp; Rescheduling
          </button>
          <button
            onClick={() => setActiveSubTab('weekly')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeSubTab === 'weekly'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Weekly Master Timetable ({weeklySlots.length})
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: DAILY SCHEDULE & RESCHEDULING */}
      {activeSubTab === 'today' && (
        <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-stone-200 bg-stone-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-stone-700">Viewing Date:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white border border-stone-200 rounded-xl px-3 py-1.5 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-400"
              />
              <span className="text-[11px] text-stone-500">
                {dailySessions.length} lab {dailySessions.length === 1 ? 'class' : 'classes'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setModalError(null);
                  setIsExtraModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Extra / Makeup Lab</span>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-xs text-stone-400">Loading daily lab schedule...</div>
          ) : dailySessions.length === 0 ? (
            <div className="p-12 text-center">
              <Clock className="w-8 h-8 text-stone-300 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-stone-700">No Lab Classes Scheduled for This Day</h3>
              <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto">
                Set up your recurring classes in <strong>Weekly Master Timetable</strong> so they appear automatically each week, or add a one-off makeup lab class here.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={() => setActiveSubTab('weekly')}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-semibold border border-stone-200 transition cursor-pointer"
                >
                  Open Weekly Timetable
                </button>
                <button
                  onClick={() => setIsExtraModalOpen(true)}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  + Add Extra Lab Today
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {dailySessions.map((session) => {
                const badge = getStatusBadge(session);
                const isCancelled = session.status === 'CANCELLED';
                return (
                  <div
                    key={session.id}
                    className={`p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition ${
                      isCancelled ? 'bg-stone-50/70 opacity-75' : 'hover:bg-stone-50/50'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-28 px-2 py-2.5 rounded-xl bg-stone-100 border border-stone-200 text-center shrink-0">
                        <div className="text-xs font-bold text-stone-900 font-mono">{format12h(session.start_time_local)}</div>
                        <div className="text-[10px] text-stone-500">to {format12h(session.end_time_local)}</div>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-bold ${isCancelled ? 'line-through text-stone-500' : 'text-stone-900'}`}>
                            {session.subject_name}
                          </span>
                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
                            {session.class_name}
                          </span>
                          <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-500 flex-wrap">
                          {session.teacher_name && (
                            <span className="flex items-center gap-1">
                              <UserCheck className="w-3.5 h-3.5 text-stone-400" />
                              <span>Teacher: <strong className="text-stone-700">{session.teacher_name}</strong></span>
                            </span>
                          )}
                          <span>•</span>
                          <span>Late after {session.late_grace_minutes} mins</span>
                        </div>

                        {session.status_note && (
                          <div className="mt-1.5 text-[11px] text-amber-800 bg-amber-50/80 border border-amber-200/80 rounded-lg px-2.5 py-1 inline-block">
                            Note: {session.status_note}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                      {!isCancelled ? (
                        <>
                          <button
                            onClick={() => openRescheduleModal(session)}
                            className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-medium border border-stone-200 transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <CalendarClock className="w-3.5 h-3.5 text-stone-600" />
                            <span>Reschedule</span>
                          </button>
                          <button
                            onClick={() => {
                              setCancellingSession(session);
                              setCancelReason('Teacher absent — lab class cancelled');
                            }}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-medium border border-rose-200 transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Teacher Absent</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleRestoreSession(session)}
                          className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium border border-emerald-200 transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restore Class</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: WEEKLY MASTER TIMETABLE */}
      {activeSubTab === 'weekly' && (
        <div className="space-y-4">
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-stone-600 mr-1">Filter Class:</span>
              <button
                onClick={() => setFilterClassId('')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                  filterClassId === ''
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                All CIT Classes
              </button>
              {classes.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setFilterClassId(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                    filterClassId === c.id
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <button
              onClick={() => openAddSlotModal()}
              className="flex items-center gap-1.5 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Weekly Lab Slot</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {DAYS.map((day) => {
              const daySlots = filteredWeeklySlots.filter((sl) => sl.day_of_week === day.id);
              return (
                <div key={day.id} className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden flex flex-col">
                  <div className="px-4 py-3 border-b border-stone-200 bg-stone-50/70 flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-900 uppercase tracking-wider">{day.name}</span>
                    <button
                      onClick={() => openAddSlotModal(day.id)}
                      className="text-[11px] font-semibold text-stone-600 hover:text-stone-900 flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>

                  <div className="p-3 space-y-2.5 flex-1">
                    {daySlots.length === 0 ? (
                      <div className="py-6 text-center text-[11px] text-stone-400">
                        No lab classes scheduled
                      </div>
                    ) : (
                      daySlots.map((slot) => (
                        <div
                          key={slot.id}
                          className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 hover:border-stone-300 transition"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-bold text-stone-900">{slot.subject_name}</div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white text-stone-700 border border-stone-200">
                                  {slot.class_name}
                                </span>
                                <span className="text-[11px] font-mono text-stone-600">
                                  {format12h(slot.start_time_str)} – {format12h(slot.end_time_str)}
                                </span>
                              </div>
                              {slot.teacher_name && (
                                <div className="text-[11px] text-stone-500 mt-1">
                                  Teacher: {slot.teacher_name}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditSlotModal(slot)}
                                title="Edit slot"
                                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-white rounded-lg transition cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteSlot(slot)}
                                title="Delete slot"
                                className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL 1: Add / Edit Weekly Timetable Slot */}
      {isSlotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button onClick={() => setIsSlotModalOpen(false)} className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-stone-900 mb-1">
              {editingSlot ? 'Edit Weekly Lab Slot' : 'Add Weekly Computer Lab Slot'}
            </h3>
            <p className="text-xs text-stone-500 mb-4">
              This slot automatically repeats every week for the selected CIT class.
            </p>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{modalError}</div>
            )}

            <form onSubmit={handleSaveSlot} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Day of Week</label>
                  <select
                    value={slotDay}
                    onChange={(e) => setSlotDay(Number(e.target.value))}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900"
                  >
                    {DAYS.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">CIT Class</label>
                  <select
                    value={slotClassId}
                    onChange={(e) => setSlotClassId(e.target.value)}
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Lab / Subject Name</label>
                <input
                  type="text"
                  required
                  value={slotSubject}
                  onChange={(e) => setSlotSubject(e.target.value)}
                  placeholder="e.g. C++ Programming Lab, Web Development Lab"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Lab Teacher Name (Optional)</label>
                <input
                  type="text"
                  value={slotTeacher}
                  onChange={(e) => setSlotTeacher(e.target.value)}
                  placeholder="e.g. Sir Ahmed / Miss Sara"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Start Time</label>
                  <input type="time" required value={slotStart} onChange={(e) => setSlotStart(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">End Time</label>
                  <input type="time" required value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Late Grace (min)</label>
                  <input type="number" min={0} max={90} value={slotGrace} onChange={(e) => setSlotGrace(Number(e.target.value))} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
                <button type="button" onClick={() => setIsSlotModalOpen(false)} className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium">Cancel</button>
                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                  {isSaving ? 'Saving...' : editingSlot ? 'Save Changes' : 'Add to Weekly Timetable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add Extra / Makeup Lab Session */}
      {isExtraModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button onClick={() => setIsExtraModalOpen(false)} className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-stone-900 mb-1">Add Extra / Makeup Lab Class</h3>
            <p className="text-xs text-stone-500 mb-4">Scheduled only for <strong>{selectedDate}</strong> without changing the weekly timetable.</p>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{modalError}</div>
            )}

            <form onSubmit={handleCreateExtra} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">CIT Class</label>
                <select value={extraClassId} onChange={(e) => setExtraClassId(e.target.value)} required className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900">
                  {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Lab / Subject Name</label>
                  <input type="text" required value={extraSubject} onChange={(e) => setExtraSubject(e.target.value)} placeholder="e.g. Networking Lab" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Teacher Name</label>
                  <input type="text" value={extraTeacher} onChange={(e) => setExtraTeacher(e.target.value)} placeholder="e.g. Sir Bilal" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Start Time</label>
                  <input type="time" required value={extraStart} onChange={(e) => setExtraStart(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">End Time</label>
                  <input type="time" required value={extraEnd} onChange={(e) => setExtraEnd(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Late Grace (min)</label>
                  <input type="number" min={0} max={90} value={extraGrace} onChange={(e) => setExtraGrace(Number(e.target.value))} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Note / Reason</label>
                <input type="text" value={extraNote} onChange={(e) => setExtraNote(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
                <button type="button" onClick={() => setIsExtraModalOpen(false)} className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium">Cancel</button>
                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                  {isSaving ? 'Adding...' : 'Schedule Extra Lab'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Reschedule Session (Teacher Absent / Time Change) */}
      {reschedulingSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button onClick={() => setReschedulingSession(null)} className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-stone-900 mb-1">Reschedule Lab Class</h3>
            <p className="text-xs text-stone-500 mb-4">
              {reschedulingSession.class_name} — {reschedulingSession.subject_name}
            </p>
            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{modalError}</div>
            )}
            <form onSubmit={handleRescheduleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">New Date</label>
                <input type="date" required value={reschedDate} onChange={(e) => setReschedDate(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">New Start Time</label>
                  <input type="time" required value={reschedStart} onChange={(e) => setReschedStart(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">New End Time</label>
                  <input type="time" required value={reschedEnd} onChange={(e) => setReschedEnd(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Teacher / Substitute Teacher</label>
                <input type="text" value={reschedTeacher} onChange={(e) => setReschedTeacher(e.target.value)} placeholder="Optional substitute teacher name" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Reason for Rescheduling</label>
                <input type="text" required value={reschedReason} onChange={(e) => setReschedReason(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
                <button type="button" onClick={() => setReschedulingSession(null)} className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium">Cancel</button>
                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                  {isSaving ? 'Updating...' : 'Save Rescheduled Time'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Teacher Absent / Cancel Class */}
      {cancellingSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button onClick={() => setCancellingSession(null)} className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-stone-900 mb-1">Cancel Lab Class (Teacher Absent)</h3>
            <p className="text-xs text-stone-500 mb-4">
              {cancellingSession.class_name} — {cancellingSession.subject_name} ({format12h(cancellingSession.start_time_local)} – {format12h(cancellingSession.end_time_local)})
            </p>
            <form onSubmit={handleCancelSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Cancellation Reason</label>
                <input type="text" required value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900" />
              </div>
              <p className="text-[11px] text-stone-500">
                The gate camera will skip attendance for this cancelled period today. Your weekly timetable remains unchanged for next week.
              </p>
              <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
                <button type="button" onClick={() => setCancellingSession(null)} className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium">Keep Class</button>
                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                  {isSaving ? 'Cancelling...' : 'Confirm Cancel Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
