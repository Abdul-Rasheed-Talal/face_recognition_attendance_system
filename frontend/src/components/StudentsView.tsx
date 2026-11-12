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
  const [selectedStudentForEnroll, setSelectedStudentForEnroll] = useState<Student | null>(null);

  // New Student Form
  const [newRoll, setNewRoll] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Face Upload Form
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);

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
        email: newEmail.trim(),
        department_id: deptId,
        class_id: classId,
      });

      setIsAddModalOpen(false);
      setNewRoll('');
      setNewName('');
      setNewEmail('');
      fetchStudents();
    } catch (err: any) {
      const msg = err.message || 'Failed to create student.';
      if (msg.includes('Authentication required') || msg.includes('token expired') || msg.includes('401')) {
        setFormError('Authentication required. Your session may have expired. Please click Sign In below.');
      } else {
        setFormError(msg);
      }
    } finally {
      setIsSubmitting(false);
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
        text: 'Authentication required. Please sign in as an Administrator or Teacher to enroll biometric faces.',
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
      }, 1800);
    } catch (err: any) {
      setEnrollMsg({
        type: 'error',
        text: err.message || 'Enrollment failed: Face must be clear, well-lit, and front-facing.',
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteTemplate = async (student: Student) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    if (!confirm(`Remove biometric face template for ${student.full_name}?`)) return;
    try {
      await api.deleteFaceTemplates(student.id);
      fetchStudents();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete student:\n\n• ${student.full_name} (${student.roll_number})\n• Email: ${student.email}\n\nThis will remove their profile, biometric face template, and attendance records permanently.`
    );
    if (!confirmed) return;

    try {
      await api.deleteStudent(student.id);
      fetchStudents();
    } catch (err: any) {
      alert(err.message || 'Failed to delete student.');
    }
  };

  return (
    <div className="space-y-6">
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
                You are viewing the student directory as Guest. Please sign in to register students and enroll face templates.
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
                <th className="py-3.5 px-4">Email</th>
                <th className="py-3.5 px-4">Biometric Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    Loading student roster...
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No students registered yet. Click &quot;Add New Student&quot; to begin.
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-750 transition">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                      {student.roll_number}
                    </td>
                    <td className="py-3 px-4 font-medium text-white">
                      {student.full_name}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {student.email}
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
                          <span>Needs Face Template</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenEnrollModal(student)}
                          className="flex items-center gap-1 px-3 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-medium transition"
                          title="Enroll or Update Face Image"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>{student.is_face_enrolled ? 'Re-Enroll Face' : 'Enroll Face'}</span>
                        </button>
                        <button
                          onClick={() => handleDeleteStudent(student)}
                          className="flex items-center gap-1 px-2.5 py-1 text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/50 rounded-lg text-xs font-medium transition"
                          title="Permanently Delete Student Record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Student Modal */}
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
              <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-300 flex flex-col gap-2">
                <span>{formError}</span>
                {formError.includes('Authentication required') && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddModalOpen(false);
                      onOpenLogin();
                    }}
                    className="self-start px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold"
                  >
                    Click Here to Sign In
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleCreateStudent} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Roll Number</label>
                <input
                  type="text"
                  required
                  value={newRoll}
                  onChange={(e) => setNewRoll(e.target.value)}
                  placeholder="e.g. CS-2023-042"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
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

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Institutional Email</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. sarah.ahmed@college.edu"
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
                      <option value="">BS CS 2023 Sec A</option>
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

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md transition disabled:opacity-50"
              >
                {isSubmitting ? 'Registering Student...' : 'Create Student Record'}
              </button>
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

            <div className="flex items-center gap-2.5 mb-4">
              <Camera className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-base font-bold text-white">Biometric Face Enrollment</h3>
                <p className="text-xs text-slate-400">
                  {selectedStudentForEnroll.full_name} ({selectedStudentForEnroll.roll_number})
                </p>
              </div>
            </div>

            {enrollMsg && (
              <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${
                enrollMsg.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/60 border-rose-800 text-rose-300'
              }`}>
                {enrollMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{enrollMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleEnrollSubmit} className="space-y-4">
              <div className="border-2 border-dashed border-slate-700 rounded-2xl p-4 text-center hover:border-slate-600 transition bg-slate-900/40">
                {previewUrl ? (
                  <div className="relative inline-block">
                    <img
                      src={previewUrl}
                      alt="Face Enrollment Preview"
                      className="w-36 h-36 object-cover rounded-xl border-2 border-cyan-500 shadow-md mx-auto"
                    />
                    <button
                      type="button"
                      onClick={() => { setFaceFile(null); setPreviewUrl(null); }}
                      className="absolute -top-2 -right-2 p-1 bg-rose-600 text-white rounded-full text-xs shadow"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="py-6">
                    <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                    <p className="text-xs font-medium text-slate-300">
                      Upload front-facing student photo
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      YuNet will validate clarity, pose, and single face.
                    </p>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="mt-3 block w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600 cursor-pointer"
                />
              </div>

              <button
                type="submit"
                disabled={!faceFile || isEnrolling}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
              >
                {isEnrolling ? 'Extracting SFace 128-d Vector...' : 'Confirm & Enroll Biometric Template'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
