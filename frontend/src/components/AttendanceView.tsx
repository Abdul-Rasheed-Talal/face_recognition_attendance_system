import React, { useState, useEffect } from 'react';
import {
  CalendarCheck,
  Download,
  Filter,
  CheckCircle2,
  Clock,
  HelpCircle,
  Edit2,
  X,
  UserCheck,
} from 'lucide-react';
import { AttendanceRecord, LabSession, Student } from '../types';
import { api } from '../services/api';

export const AttendanceView: React.FC = () => {
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Manual Override Modal
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT'>('PRESENT');
  const [overrideNotes, setOverrideNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Manual Check-In for student
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [checkInStudentId, setCheckInStudentId] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const sessList = await api.listSessions();
      setSessions(sessList);

      const active = await api.getActiveSession();
      const defaultSessId = active ? active.id : (sessList[0]?.id || '');
      setSelectedSessionId(defaultSessId);

      const stList = await api.listStudents();
      setStudents(stList);

      if (defaultSessId) {
        const attList = await api.listAttendance({ session_id: defaultSessId });
        setRecords(attList);
      }
    } catch (e) {
      console.error('Error loading attendance records:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSessionChange = async (sessId: string) => {
    setSelectedSessionId(sessId);
    try {
      const attList = await api.listAttendance({ session_id: sessId });
      setRecords(attList);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;
    setIsSaving(true);
    try {
      await api.recordManualAttendance({
        session_id: editingRecord.session_id,
        student_id: editingRecord.student_id,
        status: overrideStatus,
        notes: overrideNotes || 'Manual correction by staff',
      });
      setEditingRecord(null);
      const attList = await api.listAttendance({ session_id: selectedSessionId });
      setRecords(attList);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkInStudentId || !selectedSessionId) return;
    setIsSaving(true);
    try {
      await api.recordManualAttendance({
        session_id: selectedSessionId,
        student_id: checkInStudentId,
        status: 'PRESENT',
        notes: 'Manual roll-call check-in by staff',
      });
      setIsCheckInModalOpen(false);
      setCheckInStudentId('');
      const attList = await api.listAttendance({ session_id: selectedSessionId });
      setRecords(attList);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const exportUrl = api.getExportCsvUrl(selectedSessionId);

  // Grouping counts
  const presentCount = records.filter((r) => r.status === 'PRESENT').length;
  const lateCount = records.filter((r) => r.status === 'LATE').length;
  const excusedCount = records.filter((r) => r.status === 'EXCUSED' || r.status === 'MANUAL_CORRECTION').length;

  return (
    <div className="space-y-6">
      {/* Session Filter & Actions Bar */}
      <div className="bg-white border border-stone-200 p-4 rounded-2xl shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Filter className="w-4 h-4 text-stone-400" />
          <label className="text-xs font-semibold text-stone-700">Select Class Period:</label>
          <select
            value={selectedSessionId}
            onChange={(e) => handleSessionChange(e.target.value)}
            className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.subject_code} - {s.subject_name} ({s.class_name})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
          <button
            onClick={() => setIsCheckInModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-semibold border border-stone-200 transition cursor-pointer"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Manual Check-In</span>
          </button>
          <a
            href={exportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV / Excel</span>
          </a>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-stone-200 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-emerald-700">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="text-xs font-semibold">On-Time (Present)</span>
          </div>
          <span className="text-xl font-bold text-stone-900">{presentCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-stone-200 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-amber-700">
            <Clock className="w-5 h-5 text-amber-600" />
            <span className="text-xs font-semibold">Late Arrivals</span>
          </div>
          <span className="text-xl font-bold text-stone-900">{lateCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-stone-200 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-stone-700">
            <HelpCircle className="w-5 h-5 text-stone-500" />
            <span className="text-xs font-semibold">Manual / Excused</span>
          </div>
          <span className="text-xl font-bold text-stone-900">{excusedCount}</span>
        </div>
      </div>

      {/* Attendance Records Table */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Roll Number</th>
                <th className="py-3.5 px-4">Student Name</th>
                <th className="py-3.5 px-4">Entry Time</th>
                <th className="py-3.5 px-4">Verification</th>
                <th className="py-3.5 px-4">Confidence</th>
                <th className="py-3.5 px-4">Attendance Status</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-stone-400">
                    Loading attendance records...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-stone-400">
                    No attendance records for this class period yet. Students detected at the gate will appear here.
                  </td>
                </tr>
              ) : (
                records.map((rec) => {
                  const isLate = rec.status === 'LATE';
                  const isPresent = rec.status === 'PRESENT';
                  return (
                    <tr key={rec.id} className="hover:bg-stone-50/60 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-stone-900">
                        {rec.roll_number}
                      </td>
                      <td className="py-3 px-4 font-medium text-stone-800">{rec.student_name}</td>
                      <td className="py-3 px-4 text-stone-600 font-mono text-[11px]">
                        {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-stone-600">
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-mono border border-stone-200">
                          {rec.verification_method}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-stone-600 font-mono text-[11px]">
                        {rec.confidence_score ? `${(rec.confidence_score * 100).toFixed(0)}%` : 'Manual'}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            isPresent
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : isLate
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-stone-100 text-stone-700 border border-stone-200'
                          }`}
                        >
                          {rec.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setEditingRecord(rec);
                            setOverrideStatus(rec.status as any);
                            setOverrideNotes(rec.notes || '');
                          }}
                          title="Adjust status manually"
                          className="px-2 py-1 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Edit2 className="w-3 h-3 text-stone-500" />
                          <span>Adjust</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Override Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button
              onClick={() => setEditingRecord(null)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-stone-900 mb-1">Adjust Student Attendance</h3>
            <p className="text-xs text-stone-500 mb-4">
              {editingRecord.student_name} ({editingRecord.roll_number})
            </p>

            <form onSubmit={handleSaveOverride} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Status</label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value as any)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                >
                  <option value="PRESENT">PRESENT (On-Time)</option>
                  <option value="LATE">LATE (Late Arrival)</option>
                  <option value="EXCUSED">EXCUSED (Medical / Authorized)</option>
                  <option value="ABSENT">ABSENT</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Reason / Note</label>
                <input
                  type="text"
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  placeholder="e.g. Teacher permission granted"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Update Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Check-In Modal */}
      {isCheckInModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button
              onClick={() => setIsCheckInModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-stone-900 mb-1">Manual Student Check-In</h3>
            <p className="text-xs text-stone-500 mb-4">Select an enrolled student to mark attendance for this period.</p>

            <form onSubmit={handleManualCheckIn} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Select Student</label>
                <select
                  value={checkInStudentId}
                  onChange={(e) => setCheckInStudentId(e.target.value)}
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                >
                  <option value="">-- Choose student --</option>
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.roll_number} - {st.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsCheckInModalOpen(false)}
                  className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !checkInStudentId}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50"
                >
                  {isSaving ? 'Marking...' : 'Mark Present'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
