import React, { useState } from 'react';
import { X, Lock, Mail, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [email, setEmail] = useState('admin@college.edu');
  const [password, setPassword] = useState('AdminPass123!');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return; // Prevent double submit
    setError(null);
    setIsLoading(true);

    try {
      const auth = await api.login(email.trim(), password);
      // Construct user profile directly from login response to avoid immediate race condition
      const userObj: User = {
        id: auth.user_id,
        email: email.trim(),
        full_name: auth.full_name,
        role: auth.role as any,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      onLoginSuccess(userObj);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFillTeacher = () => {
    setEmail('prof.smith@college.edu');
    setPassword('TeacherPass123!');
  };

  const handleFillAdmin = () => {
    setEmail('admin@college.edu');
    setPassword('AdminPass123!');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl shadow-xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 rounded-lg transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-800">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-stone-900">Staff Authentication</h2>
            <p className="text-xs text-stone-500">Teacher and Administrator Access</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">Staff Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teacher@college.edu"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-10 pr-4 py-2.5 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-10 pr-4 py-2.5 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        {/* Quick Fill Preset Accounts */}
        <div className="mt-5 pt-4 border-t border-stone-100">
          <p className="text-[11px] text-stone-500 mb-2 font-medium">Preset Test Accounts:</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleFillAdmin}
              className="flex-1 py-1.5 px-2 bg-stone-100 hover:bg-stone-200 text-[11px] font-medium text-stone-700 rounded-lg border border-stone-200 transition text-center cursor-pointer"
            >
              Fill Admin
            </button>
            <button
              type="button"
              onClick={handleFillTeacher}
              className="flex-1 py-1.5 px-2 bg-stone-100 hover:bg-stone-200 text-[11px] font-medium text-stone-700 rounded-lg border border-stone-200 transition text-center cursor-pointer"
            >
              Fill Teacher
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
