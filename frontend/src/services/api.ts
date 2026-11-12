import {
  AuthResponse,
  User,
  Student,
  LabSession,
  AttendanceRecord,
  DashboardStatistics,
  CorrectionRequest,
} from '../types';

const API_BASE = 'http://localhost:8000/api/v1';

export interface DepartmentItem {
  id: string;
  code: string;
  name: string;
}

export interface ClassItem {
  id: string;
  department_id: string;
  name: string;
  year: string;
  semester: string;
  section: string;
}

class ApiService {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('fras_auth_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('fras_auth_token', token);
    } else {
      localStorage.removeItem('fras_auth_token');
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const headers = new Headers(options.headers || {});

    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      
      // Auto-handle 401 Unauthorized (expired/missing token)
      if (response.status === 401) {
        this.setToken(null);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('fras_auth_required', {
            detail: { message: errorData.detail || 'Authentication required' }
          }));
        }
      }

      throw new Error(errorData.detail || `HTTP Error ${response.status}`);
    }

    if (response.status === 204) {
      return null as T;
    }

    return response.json();
  }

  // --- Auth ---
  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.access_token);
    return data;
  }

  async getProfile(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  logout() {
    this.setToken(null);
  }

  // --- Students & Academics ---
  async listDepartments(): Promise<DepartmentItem[]> {
    return this.request<DepartmentItem[]>('/students/departments');
  }

  async listClasses(departmentId?: string): Promise<ClassItem[]> {
    const qs = departmentId ? `?department_id=${departmentId}` : '';
    return this.request<ClassItem[]>(`/students/classes${qs}`);
  }

  async listStudents(params?: { search?: string; status?: string }): Promise<Student[]> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<Student[]>(`/students${qs}`);
  }

  async createStudent(data: {
    roll_number: string;
    full_name: string;
    email: string;
    department_id: string;
    class_id: string;
  }): Promise<Student> {
    return this.request<Student>('/students', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateStudent(id: string, data: Partial<Student>): Promise<Student> {
    return this.request<Student>(`/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteStudent(id: string): Promise<void> {
    return this.request<void>(`/students/${id}`, { method: 'DELETE' });
  }

  // --- Biometric Face Enrollment ---
  async enrollFace(studentId: string, imageFile: File): Promise<{ success: boolean; message: string; quality_score: number }> {
    const formData = new FormData();
    formData.append('image', imageFile);
    return this.request<{ success: boolean; message: string; quality_score: number }>(`/enrollment/${studentId}`, {
      method: 'POST',
      body: formData,
    });
  }

  async deleteFaceTemplates(studentId: string): Promise<void> {
    return this.request<void>(`/enrollment/${studentId}`, { method: 'DELETE' });
  }

  // --- Sessions ---
  async listSessions(status?: string): Promise<LabSession[]> {
    const qs = status ? `?status=${status}` : '';
    return this.request<LabSession[]>(`/sessions${qs}`);
  }

  async getActiveSession(): Promise<LabSession | null> {
    return this.request<LabSession | null>('/sessions/active');
  }

  // --- Attendance ---
  async listAttendance(params?: { session_id?: string; student_id?: string }): Promise<AttendanceRecord[]> {
    const query = new URLSearchParams();
    if (params?.session_id) query.set('session_id', params.session_id);
    if (params?.student_id) query.set('student_id', params.student_id);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<AttendanceRecord[]>(`/attendance${qs}`);
  }

  async getStudentHistory(studentId: string): Promise<AttendanceRecord[]> {
    return this.request<AttendanceRecord[]>(`/attendance/student/${studentId}`);
  }

  async recordManualAttendance(data: {
    session_id: string;
    student_id: string;
    status: string;
    notes?: string;
  }): Promise<AttendanceRecord> {
    return this.request<AttendanceRecord>('/attendance/manual', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // --- Camera ---
  getCameraStreamUrl(): string {
    return `${API_BASE}/camera/stream`;
  }

  async getCameraStatus() {
    return this.request('/camera/status');
  }

  async reconnectCamera() {
    return this.request('/camera/reconnect', { method: 'POST' });
  }

  // --- Reports & Dashboard ---
  async getDashboardStatistics(): Promise<DashboardStatistics> {
    return this.request<DashboardStatistics>('/reports/statistics');
  }

  getExportCsvUrl(sessionId?: string): string {
    return `${API_BASE}/reports/export/csv${sessionId ? `?session_id=${sessionId}` : ''}`;
  }

  async submitCorrection(data: { session_id: string; reason: string }): Promise<CorrectionRequest> {
    return this.request<CorrectionRequest>('/reports/corrections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listCorrections(): Promise<CorrectionRequest[]> {
    return this.request<CorrectionRequest[]>('/reports/corrections');
  }
}

export const api = new ApiService();
