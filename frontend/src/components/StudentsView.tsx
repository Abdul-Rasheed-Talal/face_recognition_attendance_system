import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Search,
  Camera,
  CheckCircle2,
  Trash2,
  Upload,
  AlertCircle,
  X,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { Student } from '../types';
import { api, DepartmentItem, ClassItem } from '../services/api';

export const StudentsView: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('ALL_ACTIVE');
  const [photoFilter, setPhotoFilter] = useState<'ALL' | 'NEEDS_PHOTO' | 'ENROLLED'>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [selectedStudentForEnroll, setSelectedStudentForEnroll] = useState<Student | null>(null);

  // New Student Form (NO EMAIL)
  const [newRoll, setNewRoll] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Student Form
  const [editRoll, setEditRoll] = useState('');
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('ACTIVE');
  const [editDeptId, setEditDeptId] = useState('');
  const [editClassId, setEditClassId] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Face Upload & Live IP Camera Capture Form
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isCapturingCamera, setIsCapturingCamera] = useState(false);
  const [livePreviewKey, setLivePreviewKey] = useState<number>(Date.now());
  const [countdown, setCountdown] = useState<number | null>(null);
  const enrollStreamRef = React.useRef<HTMLImageElement | null>(null);

  // Immediately close raw MJPEG socket when modal closes or switches to frozen preview
  useEffect(() => {
    if ((!selectedStudentForEnroll || previewUrl) && enrollStreamRef.current) {
      enrollStreamRef.current.src = '';
    }
    return () => {
      if (enrollStreamRef.current) {
        enrollStreamRef.current.src = '';
      }
    };
  }, [selectedStudentForEnroll, previewUrl]);

  // Feedback banner
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadMetadata = async () => {
      try {
        const [deptList, classList] = await Promise.all([
          api.listDepartments().catch(() => []),
          api.listClasses().catch(() => []),
        ]);
        setDepartments(deptList);
        setClasses(classList);
        if (deptList.length > 0) setSelectedDeptId(deptList[0].id);
        if (classList.length > 0) setSelectedClassId(classList[0].id);
      } catch (e) {
        console.debug('Failed to load academic metadata:', e);
      }
    };
    loadMetadata();
  }, []);

  const fetchStudents = async () => {
    setIsLoading(true);
    try {
      const params: { search?: string; status?: string; class_id?: string } = {};
      if (search.trim()) params.search = search.trim();
      if (selectedClassFilter === 'GRADUATED') {
        params.status = 'GRADUATED';
      } else {
        params.status = 'ACTIVE';
        if (selectedClassFilter !== 'ALL_ACTIVE') {
          params.class_id = selectedClassFilter;
        }
      }
      const data = await api.listStudents(params);
      setStudents(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(fetchStudents, 250);
    return () => clearTimeout(timer);
  }, [search, selectedClassFilter]);

  const handleOpenAddModal = () => {
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (student: Student) => {
    setEditingStudent(student);
    setEditRoll(student.roll_number);
    setEditName(student.full_name);
    setEditStatus(student.status);
    setEditDeptId(student.department_id);
    setEditClassId(student.class_id);
    setEditError(null);
  };

  const handleOpenEnrollModal = (student: Student) => {
    setSelectedStudentForEnroll(student);
    setFaceFile(null);
    setPreviewUrl(null);
    setEnrollMsg(null);
    setCountdown(null);
    setLivePreviewKey(Date.now());
  };

  // Spacebar shortcut inside capture modal for fast hands-free snapping
  useEffect(() => {
    if (!selectedStudentForEnroll) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !previewUrl && !isCapturingCamera && countdown === null) {
        e.preventDefault();
        handleCaptureFromCamera();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedStudentForEnroll, previewUrl, isCapturingCamera, countdown]);

  // 3-2-1 Countdown capture helper
  const handleCountdownCapture = () => {
    if (countdown !== null || isCapturingCamera) return;
    setEnrollMsg(null);
    setCountdown(3);
    let c = 3;
    const timer = setInterval(() => {
      c -= 1;
      if (c > 0) {
        setCountdown(c);
      } else {
        clearInterval(timer);
        setCountdown(null);
        handleCaptureFromCamera();
      }
    }, 850);
  };

  // Capture crisp high-res frame directly from live IP camera
  const handleCaptureFromCamera = async () => {
    setIsCapturingCamera(true);
    setEnrollMsg(null);
    try {
      const file = await api.captureCameraSnapshotAsFile(
        `${selectedStudentForEnroll?.roll_number || 'student'}_ipcam.jpg`
      );
      setFaceFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setEnrollMsg({
        type: 'success',
        text: 'Snapshot ready! Verify the face is clear and click "Save Face" (or "Save & Next Student").',
      });
    } catch (err: any) {
      setEnrollMsg({
        type: 'error',
        text: err.message || 'Could not capture photo from IP camera. Ensure the camera is online.',
      });
    } finally {
      setIsCapturingCamera(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const deptId = selectedDeptId || departments[0]?.id || 'CIT';
      const classId = selectedClassId || classes[0]?.id || 'CIT 1st Year';

      const created = await api.createStudent({
        roll_number: newRoll.trim(),
        full_name: newName.trim(),
        department_id: deptId,
        class_id: classId,
      });

      setIsAddModalOpen(false);
      setNewRoll('');
      setNewName('');
      setFeedbackMsg({ type: 'success', text: `Student '${created.full_name}' added. Ready to capture face photo.` });
      await fetchStudents();
      setTimeout(() => setFeedbackMsg(null), 4000);

      // Immediately open live IP camera capture modal for the new student
      handleOpenEnrollModal(created);
    } catch (err: any) {
      setFormError(err.message || 'Failed to register student.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setEditError(null);
    setIsUpdating(true);

    try {
      await api.updateStudent(editingStudent.id, {
        roll_number: editRoll.trim(),
        full_name: editName.trim(),
        status: editStatus,
        department_id: editDeptId,
        class_id: editClassId,
      });

      setEditingStudent(null);
      setFeedbackMsg({ type: 'success', text: 'Student record updated.' });
      fetchStudents();
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update student.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFaceFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setEnrollMsg(null);
    }
  };

  const handleEnrollSubmit = async (advanceToNext = false) => {
    if (!selectedStudentForEnroll || !faceFile) return;

    setIsEnrolling(true);
    setEnrollMsg(null);
    try {
      const res = await api.enrollFace(selectedStudentForEnroll.id, faceFile);
      const currentId = selectedStudentForEnroll.id;
      setEnrollMsg({
        type: 'success',
        text: `Face enrolled! Quality Score: ${res.quality_score.toFixed(1)}`,
      });
      await fetchStudents();

      if (advanceToNext) {
        const nextPending = visibleStudents.find(
          (st) => st.id !== currentId && st.status === 'ACTIVE' && !st.is_face_enrolled
        );
        setTimeout(() => {
          if (nextPending) {
            handleOpenEnrollModal(nextPending);
          } else {
            setSelectedStudentForEnroll(null);
            setFaceFile(null);
            setPreviewUrl(null);
            setEnrollMsg(null);
            setFeedbackMsg({ type: 'success', text: 'All students in this view have enrolled face photos!' });
            setTimeout(() => setFeedbackMsg(null), 4000);
          }
        }, 700);
      } else {
        setTimeout(() => {
          setSelectedStudentForEnroll(null);
          setFaceFile(null);
          setPreviewUrl(null);
          setEnrollMsg(null);
        }, 900);
      }
    } catch (err: any) {
      setEnrollMsg({
        type: 'error',
        text: err.message || 'Enrollment failed: Ensure one clear, front-facing face is visible.',
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    const confirmed = window.confirm(
      `Permanently delete student:\n\n• ${student.full_name} (${student.roll_number})\n\nThis removes their profile, face templates, and attendance records permanently.`
    );
    if (!confirmed) return;

    try {
      await api.deleteStudent(student.id);
      setFeedbackMsg({ type: 'success', text: `Student '${student.full_name}' deleted.` });
      fetchStudents();
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to delete student.');
    }
  };

  const visibleStudents = students.filter((s) => {
    if (photoFilter === 'NEEDS_PHOTO') return !s.is_face_enrolled;
    if (photoFilter === 'ENROLLED') return s.is_face_enrolled;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Toast Feedback */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between shadow-xs ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            )}
            <span className="font-semibold">{feedbackMsg.text}</span>
          </div>
          <button onClick={() => setFeedbackMsg(null)} className="p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Class Filter Tabs */}
      <div className="bg-white border border-stone-200 p-3 rounded-2xl shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setSelectedClassFilter('ALL_ACTIVE')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              selectedClassFilter === 'ALL_ACTIVE'
                ? 'bg-stone-900 text-white'
                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
          >
            All Active CIT
          </button>
          {classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedClassFilter(c.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                selectedClassFilter === c.id
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {c.name}
            </button>
          ))}
          <button
            onClick={() => setSelectedClassFilter('GRADUATED')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              selectedClassFilter === 'GRADUATED'
                ? 'bg-stone-900 text-white'
                : 'bg-stone-50 text-stone-500 border border-stone-200 hover:bg-stone-100'
            }`}
          >
            Passed Out (Graduated)
          </button>
        </div>

        {/* Photo Status Filter */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-stone-500 font-medium">Photo:</span>
          {(['ALL', 'NEEDS_PHOTO', 'ENROLLED'] as const).map((pf) => (
            <button
              key={pf}
              onClick={() => setPhotoFilter(pf)}
              className={`px-2.5 py-1 rounded-lg font-medium border transition cursor-pointer ${
                photoFilter === pf
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
              }`}
            >
              {pf === 'ALL' ? 'All' : pf === 'NEEDS_PHOTO' ? 'Needs Photo' : 'Enrolled'}
            </button>
          ))}
        </div>
      </div>

      {/* Search & Add Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white border border-stone-200 p-4 rounded-2xl shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student name or roll number..."
            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-10 pr-4 py-2 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <span className="text-xs text-stone-500">
            Showing <strong className="text-stone-800">{visibleStudents.length}</strong> students
          </span>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Student</span>
          </button>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Roll Number</th>
                <th className="py-3.5 px-4">Full Name</th>
                <th className="py-3.5 px-4">CIT Class</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Face Recognition</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    Loading CIT student roster...
                  </td>
                </tr>
              ) : visibleStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    No students found in this filter. Import students from <strong>Academic Year &amp; Import</strong> or click <strong>Add Student</strong>.
                  </td>
                </tr>
              ) : (
                visibleStudents.map((student) => {
                  const studentClass = classes.find((c) => c.id === student.class_id);
                  return (
                    <tr key={student.id} className="hover:bg-stone-50/60 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-stone-900">
                        {student.roll_number}
                      </td>
                      <td className="py-3 px-4 font-medium text-stone-800">
                        {student.full_name}
                      </td>
                      <td className="py-3 px-4 text-stone-600">
                        {studentClass ? studentClass.name : student.class_id}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            student.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-stone-100 text-stone-600 border border-stone-200'
                          }`}
                        >
                          {student.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {student.is_face_enrolled ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Ready</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                            <span>Needs Photo</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {student.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleOpenEnrollModal(student)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition flex items-center gap-1 cursor-pointer ${
                                student.is_face_enrolled
                                  ? 'bg-stone-100 hover:bg-stone-200 text-stone-700 border-stone-200'
                                  : 'bg-stone-900 hover:bg-stone-800 text-white border-stone-900'
                              }`}
                            >
                              <Camera className="w-3.5 h-3.5" />
                              <span>{student.is_face_enrolled ? 'Retake Photo' : 'Take Photo'}</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEditModal(student)}
                            title="Edit student"
                            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(student)}
                            title="Delete student"
                            className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Student Modal (NO EMAIL) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button onClick={() => setIsAddModalOpen(false)} className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700">
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-800">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Register CIT Student</h3>
                <p className="text-xs text-stone-500">Enter roll number, full name, and CIT class</p>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateStudent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Roll Number</label>
                <input
                  type="text"
                  required
                  value={newRoll}
                  onChange={(e) => setNewRoll(e.target.value)}
                  placeholder="e.g. 24-CIT-101"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Student Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Muhammad Ali"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">CIT Class</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save & Take Photo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button onClick={() => setEditingStudent(null)} className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-stone-900 mb-1">Edit Student</h3>
            <p className="text-xs text-stone-500 mb-4">{editingStudent.full_name}</p>

            {editError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{editError}</div>
            )}

            <form onSubmit={handleUpdateStudent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Roll Number</label>
                <input type="text" required value={editRoll} onChange={(e) => setEditRoll(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Full Name</label>
                <input type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">CIT Class</label>
                  <select value={editClassId} onChange={(e) => setEditClassId(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900">
                    {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Status</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900">
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="GRADUATED">GRADUATED</option>
                  </select>
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
                <button type="button" onClick={() => setEditingStudent(null)} className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium">Cancel</button>
                <button type="submit" disabled={isUpdating} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live IP Camera Face Photo Capture & Enrollment Modal */}
      {selectedStudentForEnroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/55 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl bg-white border border-stone-200 rounded-2xl shadow-2xl p-6 relative">
            <button onClick={() => setSelectedStudentForEnroll(null)} className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 cursor-pointer">
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-between pr-8 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-stone-900 flex items-center justify-center text-white">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-stone-900">
                    {selectedStudentForEnroll.full_name}
                  </h3>
                  <p className="text-xs text-stone-500 font-mono">
                    {selectedStudentForEnroll.roll_number} · {previewUrl ? 'Step 2 of 2: Review & Confirm' : 'Step 1 of 2: Get Ready & Snap Photo'}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
                {visibleStudents.filter((s) => !s.is_face_enrolled).length} remaining without photo
              </span>
            </div>

            {enrollMsg && (
              <div
                className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  enrollMsg.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {enrollMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                )}
                <span>{enrollMsg.text}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Smooth 30 FPS Unannotated Live IP Camera Feed OR Frozen Captured Snapshot */}
              <div className="relative bg-stone-950 rounded-2xl overflow-hidden aspect-video border border-stone-200 flex items-center justify-center">
                {previewUrl ? (
                  <>
                    <img src={previewUrl} alt="Captured Student Photo" className="w-full h-full object-contain" />
                    <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-sm">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Photo Captured — Review Face Clarity</span>
                    </div>
                  </>
                ) : (
                  <>
                    <img
                      ref={enrollStreamRef}
                      key={livePreviewKey}
                      src={`${api.getCameraRawStreamUrl()}?k=${livePreviewKey}`}
                      alt="Live IP Camera Preview"
                      className="w-full h-full object-contain"
                    />
                    {/* Subtle Center Face Alignment Guide */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-44 h-56 rounded-full border-2 border-dashed border-white/65 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]" />
                    </div>
                    <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-stone-900/80 text-white text-[11px] font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Live IP Camera · Center face in oval &amp; press Space or Snap</span>
                    </div>
                    {countdown !== null && (
                      <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                        <div className="w-24 h-24 rounded-full bg-white text-stone-900 text-5xl font-black flex items-center justify-center shadow-2xl">
                          {countdown}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Clean Step-by-Step Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {!previewUrl ? (
                  <>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCaptureFromCamera}
                        disabled={isCapturingCamera || countdown !== null}
                        className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
                      >
                        <Camera className="w-4 h-4" />
                        <span>{isCapturingCamera ? 'Capturing...' : 'Snap Photo Now (Space)'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCountdownCapture}
                        disabled={isCapturingCamera || countdown !== null}
                        className="px-3.5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {countdown !== null ? `Snapping in ${countdown}...` : '3s Timer Snap'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="px-3.5 py-2 bg-white hover:bg-stone-50 text-stone-700 border border-stone-200 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload File</span>
                        <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                      </label>
                      <button
                        type="button"
                        onClick={() => setSelectedStudentForEnroll(null)}
                        className="px-3.5 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setFaceFile(null);
                        setPreviewUrl(null);
                        setEnrollMsg(null);
                        setLivePreviewKey(Date.now());
                      }}
                      className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-semibold border border-stone-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retake Photo</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleEnrollSubmit(false)}
                        disabled={!faceFile || isEnrolling}
                        className="px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-40 cursor-pointer"
                      >
                        {isEnrolling ? 'Saving...' : 'Save Face'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEnrollSubmit(true)}
                        disabled={!faceFile || isEnrolling}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-40 cursor-pointer"
                      >
                        {isEnrolling ? 'Saving...' : 'Save & Next Student →'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
