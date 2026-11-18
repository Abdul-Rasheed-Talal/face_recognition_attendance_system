import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Camera,
  CheckCircle2,
  Trash2,
  Upload,
  AlertCircle,
  X,
  LogIn,
  Shield,
  Pencil,
  GraduationCap,
  Sparkles,
} from 'lucide-react';
import { Student, User } from '../types';
import { api, DepartmentItem, ClassItem } from '../services/api';

interface StudentsViewProps {
  currentUser: User | null;
  onOpenLogin: () => void;
}

export const StudentsView: React.FC<StudentsViewProps> = ({ currentUser, onOpenLogin }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [selectedStudentForEnroll, setSelectedStudentForEnroll] = useState<Student | null>(null);

  // New Student Form (NO EMAIL REQUIRED)
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

  // Face Upload & Camera Capture Form
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isCapturingCamera, setIsCapturingCamera] = useState(false);

  // Feedback banner
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load departments and classes
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
      const data = await api.listStudents({ search });
      setStudents(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(fetchStudents, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleOpenAddModal = () => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (student: Student) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    setEditingStudent(student);
    setEditRoll(student.roll_number);
    setEditName(student.full_name);
    setEditStatus(student.status);
    setEditDeptId(student.department_id);
    setEditClassId(student.class_id);
    setEditError(null);
  };

  const handleOpenEnrollModal = (student: Student) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    setSelectedStudentForEnroll(student);
    setFaceFile(null);
    setPreviewUrl(null);
    setEnrollMsg(null);
  };

  // Capture frame directly from live camera
  const handleCaptureFromCamera = async () => {
    setIsCapturingCamera(true);
    setEnrollMsg(null);
    try {
      const file = await api.captureCameraSnapshotAsFile(`${selectedStudentForEnroll?.roll_number || 'student'}_gate_photo.jpg`);
      setFaceFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setEnrollMsg({ type: 'success', text: 'Live photo captured from gate camera! Click "Confirm & Enroll Face" below.' });
    } catch (err: any) {
      setEnrollMsg({
        type: 'error',
        text: err.message || 'Could not capture photo from gate camera. Make sure the camera is connected.',
      });
    } finally {
      setIsCapturingCamera(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    if (!currentUser) {
      setFormError('Authentication required. Please sign in as Staff.');
      setIsSubmitting(false);
      onOpenLogin();
      return;
    }

    try {
      const deptId = selectedDeptId || (departments[0]?.id || 'CS');
      const classId = selectedClassId || (classes[0]?.id || 'BS CS 2023');

      const created = await api.createStudent({
        roll_number: newRoll.trim(),
        full_name: newName.trim(),
        department_id: deptId,
        class_id: classId,
      });

      setIsAddModalOpen(false);
      setNewRoll('');
      setNewName('');
      setFeedbackMsg({ type: 'success', text: `Student '${created.full_name}' added. You can now enroll their face.` });
      await fetchStudents();
      setTimeout(() => setFeedbackMsg(null), 4000);

      // Prompt to enroll face immediately
      handleOpenEnrollModal(created);
    } catch (err: any) {
      const msg = err.message || 'Failed to create student.';
      setFormError(msg);
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
      setFeedbackMsg({ type: 'success', text: `Student updated successfully.` });
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

  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentForEnroll || !faceFile) return;

    if (!currentUser) {
      setEnrollMsg({
        type: 'error',
        text: 'Authentication required. Please sign in as an Administrator or Teacher.',
      });
      onOpenLogin();
      return;
    }

    setIsEnrolling(true);
    setEnrollMsg(null);
    try {
      const res = await api.enrollFace(selectedStudentForEnroll.id, faceFile);
      setEnrollMsg({
        type: 'success',
        text: `Face template registered successfully! (Quality score: ${res.quality_score.toFixed(1)})`,
      });
      fetchStudents();
      setTimeout(() => {
        setSelectedStudentForEnroll(null);
        setFaceFile(null);
        setPreviewUrl(null);
        setEnrollMsg(null);
      }, 1800);
    } catch (err: any) {
      setEnrollMsg({
        type: 'error',
        text: err.message || 'Enrollment failed: Ensure student is facing the camera in clear light with neutral pose.',
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    const confirmed = window.confirm(
      `Permanently delete student:\n\n• ${student.full_name} (${student.roll_number})\n\nThis will remove their profile, biometric face templates, and attendance records permanently.`
    );
    if (!confirmed) return;

    try {
      await api.deleteStudent(student.id);
      setFeedbackMsg({ type: 'success', text: `Student '${student.full_name}' permanently deleted.` });
      fetchStudents();
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to delete student.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between shadow-xs transition ${
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
          <button onClick={() => setFeedbackMsg(null)} className="p-1 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Guest Notice Banner */}
      {!currentUser && (
        <div className="p-4 rounded-2xl bg-stone-100 border border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white border border-stone-300 flex items-center justify-center text-stone-700 shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-stone-900">Staff Authentication Needed for Changes</div>
              <p className="text-[11px] text-stone-500">
                You are viewing the student roster. Sign in to add students, take photos, or manage biometric enrollment.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition shrink-0 cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        </div>
      )}

      {/* Top Action Bar */}
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

        <button
          onClick={handleOpenAddModal}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add New Student</span>
        </button>
      </div>

      {/* Students Table */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Roll Number</th>
                <th className="py-3.5 px-4">Full Name</th>
                <th className="py-3.5 px-4">Class Section</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Face Biometric</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    Loading student roster...
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    No students found. Click <strong>"Add New Student"</strong> to enroll students.
                  </td>
                </tr>
              ) : (
                students.map((student) => {
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
                            <span>Enrolled</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                            <span>Not Enrolled</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenEnrollModal(student)}
                            title="Enroll Face or Take Photo"
                            className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-medium border border-stone-200 transition flex items-center gap-1 cursor-pointer"
                          >
                            <Camera className="w-3.5 h-3.5 text-stone-600" />
                            <span>{student.is_face_enrolled ? 'Update Photo' : 'Capture Photo'}</span>
                          </button>
                          <button
                            onClick={() => handleOpenEditModal(student)}
                            title="Edit student profile"
                            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(student)}
                            title="Delete student permanently"
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
            <button
              onClick={() => setIsAddModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-800">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Register New Student</h3>
                <p className="text-xs text-stone-500">Enter roll number and name to enroll</p>
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
                <label className="block text-xs font-semibold text-stone-700 mb-1">Roll / Registration Number</label>
                <input
                  type="text"
                  required
                  value={newRoll}
                  onChange={(e) => setNewRoll(e.target.value)}
                  placeholder="e.g. 2023-CS-042"
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
                  placeholder="e.g. Ahmed Khan"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Department</label>
                  <select
                    value={selectedDeptId}
                    onChange={(e) => setSelectedDeptId(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} ({d.name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Class Section</label>
                  <select
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Registering...' : 'Save & Capture Photo'}
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
            <button
              onClick={() => setEditingStudent(null)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-800">
                <Pencil className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Edit Student Record</h3>
                <p className="text-xs text-stone-500">{editingStudent.full_name}</p>
              </div>
            </div>

            {editError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateStudent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Roll Number</label>
                <input
                  type="text"
                  required
                  value={editRoll}
                  onChange={(e) => setEditRoll(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Class</label>
                  <select
                    value={editClassId}
                    onChange={(e) => setEditClassId(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs text-stone-900"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="GRADUATED">GRADUATED</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50"
                >
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Face Photo Capture & Enrollment Modal */}
      {selectedStudentForEnroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
            <button
              onClick={() => setSelectedStudentForEnroll(null)}
              className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-800">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Biometric Face Registration</h3>
                <p className="text-xs text-stone-500">
                  {selectedStudentForEnroll.full_name} ({selectedStudentForEnroll.roll_number})
                </p>
              </div>
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

            {/* Photo Choice Tabs */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleCaptureFromCamera}
                  disabled={isCapturingCamera}
                  className="p-3 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-xl text-left flex flex-col items-center justify-center gap-1 transition cursor-pointer"
                >
                  <Camera className="w-5 h-5 text-stone-700" />
                  <span className="text-xs font-semibold text-stone-900">
                    {isCapturingCamera ? 'Capturing...' : 'Take Photo with Gate Camera'}
                  </span>
                  <span className="text-[10px] text-stone-500">Grab snapshot from entrance</span>
                </button>

                <label className="p-3 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-xl text-left flex flex-col items-center justify-center gap-1 transition cursor-pointer">
                  <Upload className="w-5 h-5 text-stone-700" />
                  <span className="text-xs font-semibold text-stone-900">Upload Photo File</span>
                  <span className="text-[10px] text-stone-500">Choose JPG or PNG file</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Photo Preview Card */}
              {previewUrl ? (
                <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 text-center">
                  <div className="w-48 h-48 mx-auto rounded-xl overflow-hidden border border-stone-300 shadow-xs mb-3 bg-stone-900 flex items-center justify-center">
                    <img src={previewUrl} alt="Face Preview" className="w-full h-full object-cover" />
                  </div>
                  <p className="text-xs text-stone-600 font-medium">Photo ready for biometric enrollment</p>
                  <p className="text-[11px] text-stone-400 mt-0.5">Ensure face is front-facing and clearly visible</p>
                </div>
              ) : (
                <div className="p-8 border-2 border-dashed border-stone-200 rounded-2xl text-center text-xs text-stone-400">
                  Click <strong>"Take Photo with Gate Camera"</strong> when the student is facing the camera, or upload a photo from your computer.
                </div>
              )}

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setSelectedStudentForEnroll(null)}
                  className="px-4 py-2 border border-stone-200 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleEnrollSubmit}
                  disabled={!faceFile || isEnrolling}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {isEnrolling ? 'Extracting Biometrics...' : 'Confirm & Enroll Face'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
