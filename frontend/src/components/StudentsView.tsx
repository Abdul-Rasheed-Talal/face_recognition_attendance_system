import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Camera,
  CheckCircle2,
  XCircle,
  Trash2,
  Upload,
  AlertCircle,
  X,
  LogIn,
  Shield,
  Pencil,
  GraduationCap,
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

  // New Student Form
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

  // Face Upload Form
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);

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

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    if (!currentUser) {
      setFormError('Authentication required. Please sign in as an Administrator or Teacher.');
      setIsSubmitting(false);
      onOpenLogin();
      return;
    }

    try {
      const deptId = selectedDeptId || (departments[0]?.id || 'CS');
      const classId = selectedClassId || (classes[0]?.id || 'BS CS 2023');

      await api.createStudent({
        roll_number: newRoll.trim(),
        full_name: newName.trim(),
        department_id: deptId,
        class_id: classId,
      });

      setIsAddModalOpen(false);
      setNewRoll('');
      setNewName('');
      setFeedbackMsg({ type: 'success', text: `Student '${newName}' registered successfully.` });
      fetchStudents();
      setTimeout(() => setFeedbackMsg(null), 3000);
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
      setFeedbackMsg({ type: 'success', text: `Student record updated.` });
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
        text: `Face template enrolled successfully! Quality Score: ${res.quality_score.toFixed(1)}`,
      });
      fetchStudents();
      setTimeout(() => {
        setSelectedStudentForEnroll(null);
        setFaceFile(null);
        setPreviewUrl(null);
        setEnrollMsg(null);
      }, 1600);
    } catch (err: any) {
      setEnrollMsg({
        type: 'error',
        text: err.message || 'Enrollment failed: Face must be clear, well-lit, and front-facing.',
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
      {/* Toast feedback */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between shadow-md transition ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300'
              : 'bg-rose-950/60 border-rose-500/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            <span className="font-semibold">{feedbackMsg.text}</span>
          </div>
          <button onClick={() => setFeedbackMsg(null)} className="p-1 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Unauthenticated Staff Banner */}
      {!currentUser && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/70 to-slate-800 border border-indigo-700/60 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Staff Authentication Required for Management</div>
              <p className="text-[11px] text-slate-300">
                You are viewing the student directory as Guest. Please sign in to register, edit, delete students, and enroll face templates.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/30 transition shrink-0"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In (Admin / Teacher)</span>
          </button>
        </div>
      )}

      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-800/80 border border-slate-700/70 p-4 rounded-2xl">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student name or roll number..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <button
          onClick={handleOpenAddModal}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-indigo-600/20 transition"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add New Student</span>
        </button>
      </div>

      {/* Students Table */}
      <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800/90 border-b border-slate-700/80 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Roll Number</th>
                <th className="py-3.5 px-4">Full Name</th>
                <th className="py-3.5 px-4">Department & Class</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Biometric Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading student roster...
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No students registered yet. Click &quot;Add New Student&quot; to begin.
                  </td>
                </tr>
              ) : (
                students.map((student) => {
                  const dept = departments.find((d) => d.id === student.department_id);
                  const cls = classes.find((c) => c.id === student.class_id);
                  return (
                    <tr key={student.id} className="hover:bg-slate-750 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                        {student.roll_number}
                      </td>
                      <td className="py-3 px-4 font-medium text-white">
                        {student.full_name}
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        <div className="font-semibold text-slate-200">{dept?.code || 'CS'}</div>
                        <div className="text-[10px] text-slate-400">{cls?.name || 'Class Section A'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            student.status === 'ACTIVE'
                              ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-400'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {student.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {student.is_face_enrolled ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-400 text-[11px] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Enrolled (SFace)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-950/60 border border-amber-800 text-amber-400 text-[11px] font-medium">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Needs Face</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenEnrollModal(student)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-medium transition"
                            title="Enroll or Update Biometric Face"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>{student.is_face_enrolled ? 'Re-Enroll' : 'Enroll'}</span>
                          </button>
                          <button
                            onClick={() => handleOpenEditModal(student)}
                            className="p-1.5 text-slate-300 hover:text-white bg-slate-700/60 hover:bg-slate-700 border border-slate-600/40 rounded-lg transition"
                            title="Edit Student Information"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(student)}
                            className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/50 rounded-lg transition"
                            title="Permanently Delete Student Record"
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

      {/* Add Student Modal (Email completely removed!) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 relative">
            <button
              onClick={() => setIsAddModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-indigo-400" />
              <span>Register New Student</span>
            </h3>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateStudent} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Roll Number / Student ID</label>
                <input
                  type="text"
                  required
                  value={newRoll}
                  onChange={(e) => setNewRoll(e.target.value)}
                  placeholder="e.g. CS-2023-042"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Sarah Ahmed"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Department</label>
                  <select
                    value={selectedDeptId}
                    onChange={(e) => setSelectedDeptId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {departments.length === 0 ? (
                      <option value="">CS & IT Department</option>
                    ) : (
                      departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} - {d.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Class Section</label>
                  <select
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {classes.length === 0 ? (
                      <option value="">Section A</option>
                    ) : (
                      classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.section})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/30 transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Registering...' : 'Register Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 relative">
            <button
              onClick={() => setEditingStudent(null)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <Pencil className="w-5 h-5 text-indigo-400" />
              <span>Edit Student Information</span>
            </h3>

            {editError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
                {editError}
              </div>
            )}

            <form onSubmit={handleUpdateStudent} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Roll Number / Student ID</label>
                <input
                  type="text"
                  required
                  value={editRoll}
                  onChange={(e) => setEditRoll(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Enrollment Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="ACTIVE">ACTIVE (Eligible for Lab Attendance)</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="GRADUATED">GRADUATED</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Department</label>
                  <select
                    value={editDeptId}
                    onChange={(e) => setEditDeptId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Class Section</label>
                  <select
                    value={editClassId}
                    onChange={(e) => setEditClassId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/30 transition disabled:opacity-50"
                >
                  {isUpdating ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Biometric Face Enrollment Modal */}
      {selectedStudentForEnroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 relative">
            <button
              onClick={() => setSelectedStudentForEnroll(null)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Camera className="w-5 h-5 text-indigo-400" />
              <span>Biometric Face Registration</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Enrolling for: <strong className="text-slate-200">{selectedStudentForEnroll.full_name}</strong> ({selectedStudentForEnroll.roll_number})
            </p>

            {enrollMsg && (
              <div
                className={`mb-4 p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  enrollMsg.type === 'success'
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-800 text-rose-300'
                }`}
              >
                {enrollMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{enrollMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleEnrollSubmit} className="space-y-4">
              <div className="border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-2xl p-6 text-center transition bg-slate-900/40 relative">
                {previewUrl ? (
                  <div className="relative inline-block">
                    <img
                      src={previewUrl}
                      alt="Student Portrait Preview"
                      className="w-36 h-36 object-cover rounded-xl border-2 border-indigo-500 shadow-lg mx-auto"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFaceFile(null);
                        setPreviewUrl(null);
                      }}
                      className="absolute -top-2 -right-2 p-1 bg-rose-600 hover:bg-rose-500 text-white rounded-full shadow"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <Upload className="w-8 h-8 text-indigo-400 mx-auto mb-2" />
                    <span className="text-xs font-semibold text-white block">Upload Frontal Face Photo</span>
                    <span className="text-[11px] text-slate-400 block mt-1">JPEG, PNG • Min 60x60px • Sharp & Well-lit</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setSelectedStudentForEnroll(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!faceFile || isEnrolling}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/30 transition disabled:opacity-50"
                >
                  {isEnrolling ? 'Extracting SFace Vector...' : 'Extract & Save Embedding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
