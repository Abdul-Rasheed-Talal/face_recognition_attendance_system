import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Calendar,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  Archive,
  Search,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { api, ClassItem } from '../services/api';

interface StudentHistoryItem {
  session_id: string;
  date: string;
  subject_name: string;
  time_12h: string;
  entry_time_12h: string | null;
  status: string;
}

interface StudentRegisterRow {
  student_id: string;
  roll_number: string;
  full_name: string;
  class_id: string;
  class_name: string;
  total_lectures: number;
  present: number;
  late: number;
  absent: number;
  attendance_pct: number;
  history: StudentHistoryItem[];
}

interface AnalyticsData {
  period: string;
  period_label: string;
  summary: {
    total_lectures: number;
    scheduled_lectures: number;
    present: number;
    late: number;
    absent: number;
    attendance_pct: number;
  };
  by_class: Array<{
    class_id: string;
    class_name: string;
    lectures: number;
    present: number;
    late: number;
    absent: number;
    attendance_pct: number;
  }>;
  daily_trend: Array<{
    date: string;
    label: string;
    present: number;
    late: number;
    absent: number;
    attendance_pct: number;
  }>;
  lectures: Array<{
    session_id: string;
    date: string;
    class_id: string;
    class_name: string;
    subject_name: string;
    teacher_name: string;
    time_12h: string;
    status: string;
    present: number;
    late: number;
    absent: number;
    total_students: number;
  }>;
  student_register: StudentRegisterRow[];
}

export const AnalyticsView: React.FC = () => {
  const [period, setPeriod] = useState<'today' | 'current_month' | 'previous_month' | 'month' | 'date'>('today');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [classId, setClassId] = useState<string>('');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [subTab, setSubTab] = useState<'students' | 'lectures' | 'archives'>('students');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  // Test Archives & Production Reset
  const [archives, setArchives] = useState<any[]>([]);
  const [archiveLabel, setArchiveLabel] = useState('');
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveBanner, setArchiveBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.listClasses().then(setClasses).catch(() => {});
  }, []);

  const loadAnalytics = async () => {
    setIsLoading(true);
    try {
      const [res, arch] = await Promise.all([
        api.getAttendanceAnalytics({
          period,
          month: period === 'month' ? selectedMonth : undefined,
          target_date: period === 'date' ? selectedDate : undefined,
          class_id: classId || undefined,
        }),
        api.listArchivedTestRecords().catch(() => []),
      ]);
      setData(res);
      setArchives(arch);
    } catch (err) {
      console.error('Failed loading analytics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [period, selectedMonth, selectedDate, classId]);

  const handleArchiveAndReset = async () => {
    const ok = window.confirm(
      `Archive all current attendance records into Test Archives and reset live attendance to 0 for production deployment?\n\n` +
      `• All existing attendance records will be safely saved under "Test Archives".\n` +
      `• Live attendance tables will start 100% fresh.\n` +
      `• Students, face photos, and the Computer Lab-1 timetable will NOT be deleted.`
    );
    if (!ok) return;

    setIsArchiving(true);
    setArchiveBanner(null);
    try {
      const res = await api.archiveTestRecordsForProduction(archiveLabel || undefined);
      setArchiveBanner({ type: 'success', text: res.message });
      setArchiveLabel('');
      await loadAnalytics();
    } catch (err: any) {
      setArchiveBanner({ type: 'error', text: err.message || 'Archive reset failed.' });
    } finally {
      setIsArchiving(false);
    }
  };

  const filteredStudents = (data?.student_register || []).filter((st) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return st.full_name.toLowerCase().includes(q) || st.roll_number.toLowerCase().includes(q);
  });

  // For vertical chart scaling
  const trendBars = data?.daily_trend || [];
  const maxTrendTotal = Math.max(1, ...trendBars.map((d) => d.present + d.late + d.absent));

  return (
    <div className="space-y-6">
      {/* Header & Period Controls */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-stone-800" />
              <h2 className="text-lg font-bold text-stone-900 tracking-tight">
                Attendance Analytics &amp; History
              </h2>
              {data?.period_label && (
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
                  {data.period_label}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Track daily &amp; monthly Present, Late, and Absent records per CIT class, lecture, and student.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {([
              { id: 'today', label: 'Today' },
              { id: 'current_month', label: 'Current Month' },
              { id: 'previous_month', label: 'Previous Month' },
              { id: 'month', label: 'Pick Month' },
              { id: 'date', label: 'Pick Day' },
            ] as const).map((btn) => (
              <button
                key={btn.id}
                onClick={() => setPeriod(btn.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  period === btn.id
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                {btn.label}
              </button>
            ))}

            <button
              onClick={loadAnalytics}
              className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 cursor-pointer"
              title="Refresh Analytics"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Optional Month / Date Picker & Class Filter */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-stone-100">
          {period === 'month' && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-stone-400" />
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-1.5 text-xs text-stone-900"
              />
            </div>
          )}

          {period === 'date' && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-stone-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-1.5 text-xs text-stone-900"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-600">Class:</span>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-1.5 text-xs text-stone-900"
            >
              <option value="">All CIT Classes (1st, 2nd &amp; 3rd Year)</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-stone-500">Lab Lectures Held</div>
          <div className="text-2xl font-bold text-stone-900 mt-1">{data?.summary.total_lectures ?? '--'}</div>
          <div className="text-[11px] text-stone-400 mt-0.5">of {data?.summary.scheduled_lectures ?? 0} scheduled</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-semibold">Present (On-Time)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{data?.summary.present ?? '--'}</div>
          <div className="text-[11px] text-stone-400 mt-0.5">student-lectures</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-amber-700">
            <span className="text-xs font-semibold">Late Arrivals</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{data?.summary.late ?? '--'}</div>
          <div className="text-[11px] text-stone-400 mt-0.5">after grace period</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-xs font-semibold">Absent</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600 mt-1">{data?.summary.absent ?? '--'}</div>
          <div className="text-[11px] text-stone-400 mt-0.5">missed lab lectures</div>
        </div>
        <div className="col-span-2 lg:col-span-1 bg-stone-900 text-white rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-stone-300">Overall Attendance</div>
          <div className="text-2xl font-bold mt-1">{data ? `${data.summary.attendance_pct}%` : '--'}</div>
          <div className="text-[11px] text-stone-400 mt-0.5">Present + Late rate</div>
        </div>
      </div>

      {/* Visual Graphs Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Graph 1: Per-Class Stacked Horizontal Bar Chart */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">Attendance by CIT Class</h3>
            <div className="flex items-center gap-3 text-[10px] text-stone-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" /> Present</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-xs bg-amber-400" /> Late</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-xs bg-rose-300" /> Absent</span>
            </div>
          </div>

          <div className="space-y-4">
            {(data?.by_class || []).map((cls) => {
              const total = cls.present + cls.late + cls.absent;
              const pPct = total > 0 ? (cls.present / total) * 100 : 0;
              const lPct = total > 0 ? (cls.late / total) * 100 : 0;
              const aPct = total > 0 ? (cls.absent / total) * 100 : 0;

              return (
                <div key={cls.class_id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-stone-800">{cls.class_name}</span>
                    <span className="text-stone-500">
                      <strong className="text-stone-900">{cls.attendance_pct}%</strong> · {cls.lectures} lecture{cls.lectures === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="w-full h-4 bg-stone-100 rounded-full overflow-hidden flex border border-stone-200/70">
                    {pPct > 0 && <div style={{ width: `${pPct}%` }} className="bg-emerald-500 h-full transition-all" title={`Present: ${cls.present}`} />}
                    {lPct > 0 && <div style={{ width: `${lPct}%` }} className="bg-amber-400 h-full transition-all" title={`Late: ${cls.late}`} />}
                    {aPct > 0 && <div style={{ width: `${aPct}%` }} className="bg-rose-300 h-full transition-all" title={`Absent: ${cls.absent}`} />}
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-stone-500">
                    <span className="text-emerald-700 font-medium">Present: {cls.present}</span>
                    <span className="text-amber-700 font-medium">Late: {cls.late}</span>
                    <span className="text-rose-600 font-medium">Absent: {cls.absent}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Graph 2: Daily Trend Vertical Bar Chart */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">Daily Attendance Trend</h3>
            <span className="text-[11px] text-stone-500">{trendBars.length} day{trendBars.length === 1 ? '' : 's'} with lab lectures</span>
          </div>

          {trendBars.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10 text-xs text-stone-400">
              No completed or ongoing lab lectures in this period yet.
            </div>
          ) : (
            <div className="flex-1 flex items-end gap-2 pt-4 pb-2 min-h-[160px] overflow-x-auto">
              {trendBars.map((d) => {
                const total = d.present + d.late + d.absent;
                const barH = Math.max(12, Math.round((total / maxTrendTotal) * 120));
                const pH = total > 0 ? Math.round((d.present / total) * barH) : 0;
                const lH = total > 0 ? Math.round((d.late / total) * barH) : 0;
                const aH = Math.max(0, barH - pH - lH);

                return (
                  <div key={d.date} className="flex-1 min-w-[44px] flex flex-col items-center gap-1.5 group">
                    <span className="text-[10px] font-bold text-stone-700">{d.attendance_pct}%</span>
                    <div
                      className="w-8 rounded-lg overflow-hidden flex flex-col-reverse border border-stone-200 bg-stone-100"
                      style={{ height: `${barH}px` }}
                      title={`${d.label}: Present ${d.present}, Late ${d.late}, Absent ${d.absent}`}
                    >
                      {pH > 0 && <div style={{ height: `${pH}px` }} className="bg-emerald-500 w-full" />}
                      {lH > 0 && <div style={{ height: `${lH}px` }} className="bg-amber-400 w-full" />}
                      {aH > 0 && <div style={{ height: `${aH}px` }} className="bg-rose-300 w-full" />}
                    </div>
                    <span className="text-[10px] text-stone-500 font-medium whitespace-nowrap">{d.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sub-Tabs: Student Register | Lecture Log | Test Archives & Production Reset */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-stone-200 bg-stone-50/70 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSubTab('students')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                subTab === 'students' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-200/70'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Student Register ({filteredStudents.length})</span>
            </button>
            <button
              onClick={() => setSubTab('lectures')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                subTab === 'lectures' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-200/70'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Lecture Breakdown ({data?.lectures.length ?? 0})</span>
            </button>
            <button
              onClick={() => setSubTab('archives')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                subTab === 'archives' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-200/70'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Test Archives &amp; Production Reset ({archives.length})</span>
            </button>
          </div>

          {subTab === 'students' && (
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search student or roll no..."
                className="w-full bg-white border border-stone-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-stone-900"
              />
            </div>
          )}
        </div>

        {/* SUB-TAB 1: Student-by-Student Register */}
        {subTab === 'students' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Roll No</th>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Class</th>
                  <th className="py-3 px-4 text-center">Lectures</th>
                  <th className="py-3 px-4 text-center">Present</th>
                  <th className="py-3 px-4 text-center">Late</th>
                  <th className="py-3 px-4 text-center">Absent</th>
                  <th className="py-3 px-4 text-center">Rate</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredStudents.map((st) => {
                  const isOpen = expandedStudentId === st.student_id;
                  return (
                    <React.Fragment key={st.student_id}>
                      <tr className="hover:bg-stone-50/70 transition">
                        <td className="py-3 px-4 font-mono font-semibold text-stone-900">{st.roll_number}</td>
                        <td className="py-3 px-4 font-medium text-stone-800">{st.full_name}</td>
                        <td className="py-3 px-4 text-stone-600">{st.class_name}</td>
                        <td className="py-3 px-4 text-center font-semibold text-stone-700">{st.total_lectures}</td>
                        <td className="py-3 px-4 text-center font-bold text-emerald-700">{st.present}</td>
                        <td className="py-3 px-4 text-center font-bold text-amber-600">{st.late}</td>
                        <td className="py-3 px-4 text-center font-bold text-rose-600">{st.absent}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              st.total_lectures === 0
                                ? 'bg-stone-100 text-stone-500'
                                : st.attendance_pct >= 75
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {st.attendance_pct}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => setExpandedStudentId(isOpen ? null : st.student_id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-medium cursor-pointer"
                          >
                            <span>History</span>
                            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-stone-50/80">
                          <td colSpan={9} className="p-4">
                            {st.history.length === 0 ? (
                              <div className="text-xs text-stone-400">No lectures held for {st.class_name} in this period yet.</div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {st.history.map((h, i) => (
                                  <div key={i} className="p-2.5 rounded-xl bg-white border border-stone-200 flex items-center justify-between gap-2">
                                    <div>
                                      <div className="text-xs font-bold text-stone-900">{h.subject_name}</div>
                                      <div className="text-[11px] text-stone-500">
                                        {h.date} · {h.time_12h}
                                      </div>
                                      {h.entry_time_12h && (
                                        <div className="text-[10px] text-stone-400">Entered at {h.entry_time_12h}</div>
                                      )}
                                    </div>
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                        h.status === 'PRESENT' || h.status === 'EXCUSED'
                                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                          : h.status === 'LATE'
                                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                                      }`}
                                    >
                                      {h.status}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* SUB-TAB 2: Lecture Breakdown */}
        {subTab === 'lectures' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Time (12h)</th>
                  <th className="py-3 px-4">Class</th>
                  <th className="py-3 px-4">Subject &amp; Teacher</th>
                  <th className="py-3 px-4 text-center">Present</th>
                  <th className="py-3 px-4 text-center">Late</th>
                  <th className="py-3 px-4 text-center">Absent</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {(data?.lectures || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-stone-400">No lectures found for this period.</td>
                  </tr>
                ) : (
                  (data?.lectures || []).map((lec) => (
                    <tr key={lec.session_id} className="hover:bg-stone-50/70">
                      <td className="py-3 px-4 font-mono text-stone-700">{lec.date}</td>
                      <td className="py-3 px-4 font-mono text-stone-700 whitespace-nowrap">{lec.time_12h}</td>
                      <td className="py-3 px-4 font-semibold text-stone-900">{lec.class_name}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-stone-900">{lec.subject_name}</div>
                        {lec.teacher_name && <div className="text-[11px] text-stone-500">{lec.teacher_name}</div>}
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-emerald-700">{lec.present}</td>
                      <td className="py-3 px-4 text-center font-bold text-amber-600">{lec.late}</td>
                      <td className="py-3 px-4 text-center font-bold text-rose-600">{lec.absent}</td>
                      <td className="py-3 px-4 text-right">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                          {lec.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUB-TAB 3: Production Deployment Reset & Archived Test Records */}
        {subTab === 'archives' && (
          <div className="p-5 space-y-5">
            {/* Production Reset Action Box */}
            <div className="p-5 rounded-2xl bg-amber-50/60 border border-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-bold text-stone-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Archive Test Records &amp; Reset for Production Deployment</span>
                </div>
                <p className="text-xs text-stone-600 max-w-2xl">
                  Press this when you are ready to launch live in Computer Lab-1. Every current attendance record is safely saved below in <strong>Test Archives</strong>, and live attendance starts completely fresh (students, face photos, and the timetable remain untouched).
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={archiveLabel}
                  onChange={(e) => setArchiveLabel(e.target.value)}
                  placeholder="Optional batch label (e.g. Lab Test Run)"
                  className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 w-56"
                />
                <button
                  onClick={handleArchiveAndReset}
                  disabled={isArchiving}
                  className="px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isArchiving ? 'Archiving...' : 'Archive & Start Fresh'}
                </button>
              </div>
            </div>

            {archiveBanner && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-medium ${
                  archiveBanner.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {archiveBanner.text}
              </div>
            )}

            {/* Archived Test Records Table */}
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-xs font-bold text-stone-700">
                Saved Test Records ({archives.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-stone-50/50 border-b border-stone-200 text-stone-500 text-[11px] uppercase">
                      <th className="py-2.5 px-4">Archive Batch</th>
                      <th className="py-2.5 px-4">Date &amp; Time</th>
                      <th className="py-2.5 px-4">Class &amp; Lecture</th>
                      <th className="py-2.5 px-4">Roll No</th>
                      <th className="py-2.5 px-4">Student</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {archives.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-stone-400">
                          No test records archived yet.
                        </td>
                      </tr>
                    ) : (
                      archives.map((a) => (
                        <tr key={a.id} className="hover:bg-stone-50/60">
                          <td className="py-2.5 px-4 text-stone-600">{a.archive_batch_name}</td>
                          <td className="py-2.5 px-4 font-mono text-stone-700">{a.session_date} · {a.entry_time_12h}</td>
                          <td className="py-2.5 px-4 text-stone-800">{a.class_name} — {a.subject_name}</td>
                          <td className="py-2.5 px-4 font-mono font-semibold text-stone-900">{a.roll_number}</td>
                          <td className="py-2.5 px-4 font-medium text-stone-800">{a.student_name}</td>
                          <td className="py-2.5 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-200">
                              {a.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
