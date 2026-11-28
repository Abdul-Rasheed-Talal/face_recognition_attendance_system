import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  Upload,
  FolderOpen,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Users,
  RefreshCw,
  FileJson,
  CalendarDays,
} from 'lucide-react';
import { AcademicSummary } from '../types';
import { api } from '../services/api';

export const AcademicYearView: React.FC = () => {
  const [summary, setSummary] = useState<AcademicSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Import states
  const [isImportingFolder, setIsImportingFolder] = useState(false);
  const [isUploadingJson, setIsUploadingJson] = useState(false);
  const [uploadDefaultClass, setUploadDefaultClass] = useState('CIT 1st Year');
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Rollover states
  const [academicYearLabel, setAcademicYearLabel] = useState(() => {
    const y = new Date().getFullYear();
    return `${y}-${y + 1}`;
  });
  const [clearTimetable, setClearTimetable] = useState(false);
  const [isRollingOver, setIsRollingOver] = useState(false);
  const [rolloverMessage, setRolloverMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSummary = async () => {
    setIsLoading(true);
    try {
      const data = await api.getAcademicSummary();
      setSummary(data);
    } catch (e) {
      console.error('Failed loading academic summary:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const handleImportFromFolder = async () => {
    setIsImportingFolder(true);
    setImportMessage(null);
    try {
      const res = await api.importStudentsFromFolder(true);
      const splitNote = res.split_files_created.length > 0
        ? ` Split into per-class files: ${res.split_files_created.join(', ')}.`
        : '';
      setImportMessage({
        type: 'success',
        text: `Imported ${res.imported} CIT students (${res.skipped_duplicates} already existed).${splitNote}`,
      });
      await loadSummary();
    } catch (err: any) {
      setImportMessage({
        type: 'error',
        text: err.message || 'Could not import from Registered CIT Students folder.',
      });
    } finally {
      setIsImportingFolder(false);
    }
  };

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingJson(true);
    setImportMessage(null);
    try {
      const res = await api.importStudentsJsonFile(file, uploadDefaultClass);
      setImportMessage({
        type: 'success',
        text: `Imported ${res.imported} students from ${file.name} (${res.skipped_duplicates} duplicates skipped).`,
      });
      await loadSummary();
    } catch (err: any) {
      setImportMessage({
        type: 'error',
        text: err.message || 'Failed to import JSON file.',
      });
    } finally {
      setIsUploadingJson(false);
      e.target.value = '';
    }
  };

  const handleRollover = async () => {
    const ok = window.confirm(
      `Confirm Annual Academic Year Rollover (${academicYearLabel})?\n\n` +
      `• CIT 3rd Year students will PASS OUT (marked Graduated & removed from live camera).\n` +
      `• CIT 2nd Year students will move to CIT 3rd Year (keeping their face photos).\n` +
      `• CIT 1st Year students will move to CIT 2nd Year (keeping their face photos).\n` +
      `• CIT 1st Year will become ready for new batch enrollment.` +
      (clearTimetable ? `\n• Weekly Lab Timetable will be cleared for the new year.` : '')
    );
    if (!ok) return;

    setIsRollingOver(true);
    setRolloverMessage(null);
    try {
      const res = await api.performAcademicRollover({
        academic_year_label: academicYearLabel,
        clear_weekly_timetable: clearTimetable,
      });
      setRolloverMessage({ type: 'success', text: res.message });
      await loadSummary();
    } catch (err: any) {
      setRolloverMessage({ type: 'error', text: err.message || 'Rollover failed.' });
    } finally {
      setIsRollingOver(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-stone-800" />
            <h2 className="text-lg font-bold text-stone-900 tracking-tight">Academic Year &amp; CIT Student Import</h2>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Import registered CIT students from JSON files and perform yearly class promotion when 3rd Year passes out.
          </p>
        </div>
        <button
          onClick={loadSummary}
          className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-medium border border-stone-200 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Live CIT Class Counts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(summary?.classes || []).map((c) => (
          <div key={c.class_id} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between text-stone-500 mb-2">
              <span className="text-xs font-bold text-stone-800">{c.class_name}</span>
              <Users className="w-4 h-4 text-stone-400" />
            </div>
            <div className="text-2xl font-bold text-stone-900">{c.active_students}</div>
            <div className="text-[11px] text-stone-500 mt-1">
              Face Photos Enrolled:{' '}
              <strong className={c.face_enrolled === c.active_students && c.active_students > 0 ? 'text-emerald-700' : 'text-amber-700'}>
                {c.face_enrolled} / {c.active_students}
              </strong>
            </div>
          </div>
        ))}

        <div className="bg-stone-100/70 border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-bold text-stone-700">Passed Out (Graduated)</span>
            <GraduationCap className="w-4 h-4 text-stone-400" />
          </div>
          <div className="text-2xl font-bold text-stone-700">{summary?.total_graduated ?? 0}</div>
          <div className="text-[11px] text-stone-500 mt-1">Archived from active camera</div>
        </div>
      </div>

      {/* Section 1: Bulk Import CIT Students from JSON */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <FileJson className="w-5 h-5 text-stone-800" />
          <h3 className="text-sm font-bold text-stone-900">Import Registered CIT Students (JSON)</h3>
        </div>
        <p className="text-xs text-stone-500">
          Place <code className="bg-stone-100 px-1.5 py-0.5 rounded text-stone-800">students.json</code> (or separate per-class JSON files) inside the{' '}
          <code className="bg-stone-100 px-1.5 py-0.5 rounded text-stone-800">Registered CIT Students</code> folder, or upload a JSON file directly below. Combined files are automatically split into separate class files.
        </p>

        {importMessage && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start gap-2 ${
              importMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {importMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span>{importMessage.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option A: Import from Project Folder */}
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-stone-900">
                <FolderOpen className="w-4 h-4 text-stone-600" />
                <span>Registered CIT Students Folder</span>
              </div>
              <p className="text-[11px] text-stone-500 mt-1">
                {summary && summary.folder_json_files.length > 0 ? (
                  <>Detected files: <strong className="text-stone-800">{summary.folder_json_files.join(', ')}</strong></>
                ) : (
                  <>No JSON file detected in <code className="text-stone-700">Registered CIT Students/</code> yet. Drop <code className="text-stone-700">students.json</code> there and click Refresh.</>
                )}
              </p>
            </div>
            <button
              onClick={handleImportFromFolder}
              disabled={isImportingFolder}
              className="w-full py-2 px-4 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
            >
              {isImportingFolder ? 'Importing & Splitting...' : 'Import & Split from Folder'}
            </button>
          </div>

          {/* Option B: Direct File Upload */}
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-stone-900">
                <Upload className="w-4 h-4 text-stone-600" />
                <span>Upload JSON File Directly</span>
              </div>
              <div className="mt-2">
                <label className="block text-[11px] text-stone-500 mb-1">Default Class (if file has one class):</label>
                <select
                  value={uploadDefaultClass}
                  onChange={(e) => setUploadDefaultClass(e.target.value)}
                  className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs text-stone-800"
                >
                  <option value="CIT 1st Year">CIT 1st Year</option>
                  <option value="CIT 2nd Year">CIT 2nd Year</option>
                  <option value="CIT 3rd Year">CIT 3rd Year</option>
                </select>
              </div>
            </div>
            <label className="w-full py-2 px-4 bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 rounded-xl text-xs font-semibold text-center transition cursor-pointer">
              {isUploadingJson ? 'Importing File...' : 'Choose JSON File to Import'}
              <input type="file" accept=".json,application/json" onChange={handleJsonUpload} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      {/* Section 2: Annual Academic Year Rollover */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-stone-800" />
          <h3 className="text-sm font-bold text-stone-900">Annual Academic Year Rollover (Promote Classes)</h3>
        </div>
        <p className="text-xs text-stone-500">
          Use this once per year at the start of a new academic session. All promoted students keep their enrolled face photos automatically — you only need to enroll the new CIT 1st Year batch!
        </p>

        {/* Visual Promotion Flow */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200 flex items-center justify-between">
            <span className="font-semibold text-stone-800">CIT 3rd Year</span>
            <ArrowRight className="w-4 h-4 text-rose-500" />
            <span className="font-bold text-rose-700">Passed Out</span>
          </div>
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between">
            <span className="font-semibold text-stone-800">CIT 2nd Year</span>
            <ArrowRight className="w-4 h-4 text-stone-400" />
            <span className="font-bold text-stone-900">CIT 3rd Year</span>
          </div>
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between">
            <span className="font-semibold text-stone-800">CIT 1st Year</span>
            <ArrowRight className="w-4 h-4 text-stone-400" />
            <span className="font-bold text-stone-900">CIT 2nd Year</span>
          </div>
        </div>

        {rolloverMessage && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start gap-2 ${
              rolloverMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {rolloverMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span>{rolloverMessage.text}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-stone-100">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1">New Academic Year</label>
              <input
                type="text"
                value={academicYearLabel}
                onChange={(e) => setAcademicYearLabel(e.target.value)}
                className="w-36 bg-stone-50 border border-stone-200 rounded-xl px-3 py-1.5 text-xs text-stone-900 font-medium"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-stone-700 mt-3 sm:mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={clearTimetable}
                onChange={(e) => setClearTimetable(e.target.checked)}
                className="rounded border-stone-300"
              />
              <span>Also clear Weekly Lab Timetable ({summary?.weekly_timetable_slots ?? 0} slots)</span>
            </label>
          </div>

          <button
            onClick={handleRollover}
            disabled={isRollingOver}
            className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer shrink-0"
          >
            {isRollingOver ? 'Promoting Classes...' : 'Run Annual Class Promotion'}
          </button>
        </div>
      </div>
    </div>
  );
};
