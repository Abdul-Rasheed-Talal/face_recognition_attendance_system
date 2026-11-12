import React, { useState } from 'react';
import {
  GraduationCap,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Send,
} from 'lucide-react';
import { Student, AttendanceRecord, LabSession } from '../types';
import { api } from '../services/api';

export const StudentPortalView: React.FC = () => {
  const [rollNumber, setRollNumber] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dispute form
  const [disputeSessionId, setDisputeSessionId] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeSuccess, setDisputeSuccess] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rollNumber.trim()) return;
    setIsLoading(true);
    setError(null);
    setStudent(null);
    setRecords([]);

    try {
      const allStudents = await api.listStudents({ search: rollNumber.trim() });
      const found = allStudents.find(
        (s) => s.roll_number.toLowerCase() === rollNumber.trim().toLowerCase()
      );

      if (!found) {
        setError(`No student found with Roll Number "${rollNumber}".`);
        return;
      }

      setStudent(found);
      const attRecords = await api.getStudentHistory(found.id);
      setRecords(attRecords);

      const sessList = await api.listSessions();
      setSessions(sessList);
    } catch (err: any) {
      setError(err.message || 'Error looking up student records.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisputeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeSessionId || !disputeReason) return;
    try {
      await api.submitCorrection({
        session_id: disputeSessionId,
        reason: disputeReason,
      });
      setDisputeSuccess(true);
      setDisputeReason('');
      setTimeout(() => setDisputeSuccess(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Could not submit dispute. Ensure you are signed in or contact teacher.');
    }
  };

  const presentCount = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const totalRecords = records.length;
  const pct = totalRecords > 0 ? ((presentCount / totalRecords) * 100).toFixed(0) : '0';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Student Roll Number Lookup Form */}
      <div className="bg-slate-800/90 border border-slate-700/80 p-6 rounded-2xl shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Student Self-Service Portal</h2>
            <p className="text-xs text-slate-400">
              Check automated attendance history, percentage, and submit dispute reviews
            </p>
          </div>
        </div>

        <form onSubmit={handleLookup} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              required
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder="Enter your student roll number (e.g. CS-2023-042)..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md transition disabled:opacity-50"
          >
            {isLoading ? 'Checking...' : 'Check Attendance'}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
            {error}
          </div>
        )}
      </div>

      {/* Results View */}
      {student && (
        <div className="space-y-6">
          {/* Profile & KPI Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
              <div className="text-xs text-slate-400">Student Profile</div>
              <div className="text-base font-bold text-white mt-1">{student.full_name}</div>
              <div className="text-xs font-mono text-cyan-400 mt-0.5">{student.roll_number}</div>
              <div className="text-[11px] text-slate-500 mt-2">Class: {student.class_id}</div>
            </div>

            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
              <div className="text-xs text-slate-400">Attended Sessions</div>
              <div className="text-2xl font-bold text-white mt-1">
                {presentCount} <span className="text-xs text-slate-400 font-normal">/ {totalRecords} recorded</span>
              </div>
              <div className="text-[11px] text-emerald-400 mt-2">
                {records.filter(r => r.status === 'PRESENT').length} On-Time, {records.filter(r => r.status === 'LATE').length} Late
              </div>
            </div>

            <div className="bg-gradient-to-br from-indigo-950/40 to-slate-800 border border-indigo-700/50 rounded-2xl p-4">
              <div className="text-xs text-indigo-300">Attendance Percentage</div>
              <div className="text-3xl font-extrabold text-cyan-300 mt-1">{pct}%</div>
              <div className="text-[11px] text-slate-400 mt-2">
                {Number(pct) >= 75 ? (
                  <span className="text-emerald-400 font-medium">Eligible for examinations</span>
                ) : (
                  <span className="text-rose-400 font-medium">Below 75% required threshold</span>
                )}
              </div>
            </div>
          </div>

          {/* Attendance History Table */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-700 font-bold text-sm text-white">
              Verified Attendance History
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-800/90 border-b border-slate-700 text-slate-400 uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Session ID</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4">Confidence</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500">
                        No automated attendance records logged yet.
                      </td>
                    </tr>
                  ) : (
                    records.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-750">
                        <td className="py-3 px-4 text-slate-200">
                          {new Date(r.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">
                          {r.session_id.substring(0, 8)}...
                        </td>
                        <td className="py-3 px-4 text-slate-300">{r.verification_method}</td>
                        <td className="py-3 px-4 font-mono text-cyan-400">
                          {r.confidence_score ? `${(r.confidence_score * 100).toFixed(0)}%` : '--'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            r.status === 'PRESENT'
                              ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-400'
                              : r.status === 'LATE'
                              ? 'bg-amber-950/60 border border-amber-800 text-amber-400'
                              : 'bg-rose-950/60 border border-rose-800 text-rose-400'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Missing Attendance Correction Dispute Form */}
          <div className="bg-slate-800/80 border border-slate-700 p-5 rounded-2xl">
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Submit Attendance Review Request</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              If an entrance was missed or incorrectly flagged, submit a review request for teacher verification.
            </p>

            {disputeSuccess && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Review request submitted successfully. The laboratory teacher will review your request.</span>
              </div>
            )}

            <form onSubmit={handleDisputeSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Session</label>
                <select
                  required
                  value={disputeSessionId}
                  onChange={(e) => setDisputeSessionId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">-- Select Lab Session --</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject_code} - {s.subject_name} ({s.room_number})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Reason for Adjustment</label>
                <textarea
                  required
                  rows={2}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Explain why you were present (e.g. entered during group arrival at 09:05 AM)..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <button
                type="submit"
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Submit Request</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

