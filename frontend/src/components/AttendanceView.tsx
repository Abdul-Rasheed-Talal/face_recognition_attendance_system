import React, { useState, useEffect } from 'react';
import {
  CalendarCheck,
  Download,
  Filter,
  CheckCircle2,
  Clock,
  XCircle,
  HelpCircle,
  Edit2,
  X,
  FileSpreadsheet,
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

  // Manual Check-In for absent student
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
      console.error(e);
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
        notes: overrideNotes || 'Manual teacher correction',
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
        notes: 'Manual teacher roll-call entry',
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
  const presentCount = records.filter(r => r.status === 'PRESENT').length;
  const lateCount = records.filter(r => r.status === 'LATE').length;
  const excusedCount = records.filter(r => r.status === 'EXCUSED').length;

  return (
    <div className="space-y-6">
      {/* Session Filter & Actions */}
      <div className="bg-slate-800/80 border border-slate-700/70 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <label className="text-xs font-medium text-slate-300">Select Lab Session:</label>
          <select
            value={selectedSessionId}
            onChange={(e) => handleSessionChange(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.subject_code} - {s.subject_name} ({s.room_number})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
          <button
            onClick={() => setIsCheckInModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition"
          >
            <span>+ Manual Student Check-in</span>
          </button>
          <a
            href={exportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold shadow-md transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-xs font-medium">On-Time (Present)</span>
          </div>
          <span className="text-base font-bold text-white">{presentCount}</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-400">
            <Clock className="w-4 h-4" />
            <span className="text-xs font-medium">Late (Grace Exceeded)</span>
          </div>
          <span className="text-base font-bold text-white">{lateCount}</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-cyan-400">
            <HelpCircle className="w-4 h-4" />
            <span className="text-xs font-medium">Excused / Overridden</span>
          </div>
          <span className="text-base font-bold text-white">{excusedCount}</span>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800/90 border-b border-slate-700/80 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Roll Number</th>
                <th className="py-3.5 px-4">Student Name</th>
                <th className="py-3.5 px-4">Recorded Time (UTC)</th>
                <th className="py-3.5 px-4">Verification Method</th>
                <th className="py-3.5 px-4">Confidence</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Teacher Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Loading attendance records...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No attendance records for this session yet.
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-750 transition">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                      {rec.roll_number}
                    </td>
                    <td className="py-3 px-4 font-medium text-white">
                      {rec.student_name}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-[11px] text-slate-300">
                        {rec.verification_method}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-cyan-400">
                      {rec.confidence_score ? `${(rec.confidence_score * 100).toFixed(0)}%` : '--'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                        rec.status === 'PRESENT'
                          ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-400'
                          : rec.status === 'LATE'
                          ? 'bg-amber-950/60 border border-amber-800 text-amber-400'
                          : rec.status === 'EXCUSED'
                          ? 'bg-cyan-950/60 border border-cyan-800 text-cyan-400'
                          : 'bg-rose-950/60 border border-rose-800 text-rose-400'
                      }`}>
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
                        className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-700/60 rounded-lg transition"
                        title="Override Status"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Override Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 relative">
            <button
              onClick={() => setEditingRecord(null)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-1">Manual Attendance Correction</h3>
            <p className="text-xs text-slate-400 mb-4">
              Student: {editingRecord.student_name} ({editingRecord.roll_number})
            </p>

            <form onSubmit={handleSaveOverride} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Set Status</label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="PRESENT">PRESENT (On Time)</option>
                  <option value="LATE">LATE (Arrived after grace)</option>
                  <option value="EXCUSED">EXCUSED (Authorized Leave)</option>
                  <option value="ABSENT">ABSENT</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Teacher Notes</label>
                <textarea
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  placeholder="Reason for manual adjustment..."
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                {isSaving ? 'Updating...' : 'Save Correction'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manual Check-in Modal */}
      {isCheckInModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 relative">
            <button
              onClick={() => setIsCheckInModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-4">Manual Roll-Call Check-in</h3>

            <form onSubmit={handleManualCheckIn} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Select Student</label>
                <select
                  required
                  value={checkInStudentId}
                  onChange={(e) => setCheckInStudentId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- Choose student --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.roll_number} - {s.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={!checkInStudentId || isSaving}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                {isSaving ? 'Recording...' : 'Mark Present'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
