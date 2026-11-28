import {
  AuthResponse,
  User,
  Student,
  LabSession,
  AttendanceRecord,
  DashboardStatistics,
  CorrectionRequest,
  CameraDevice,
} from '../types';

const getApiBase = (): string => {
  if (typeof window === 'undefined') return 'http://localhost:8000/api/v1';
  // If served directly from the backend (port 8000), use clean relative paths
  if (window.location.port === '8000') {
    return '/api/v1';
  }
  // If running in development (e.g. Vite 5173), match current hostname on port 8000
  return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
};

const API_BASE = getApiBase();

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
      if (response.status === 401 && this.token) {
        this.setToken(null);
        if (typeof window !== 'undefined' && !endpoint.includes('/auth/')) {
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

  async listStudents(params?: { search?: string; status?: string; class_id?: string }): Promise<Student[]> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    if (params?.class_id) query.set('class_id', params.class_id);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<Student[]>(`/students${qs}`);
  }

  async createStudent(data: {
    roll_number: string;
    full_name: string;
    email?: string;
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

  // --- Academics (create) ---
  async createDepartment(data: { code: string; name: string }): Promise<DepartmentItem> {
    return this.request<DepartmentItem>('/students/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createClass(data: {
    department_id: string;
    name: string;
    year: string;
    semester: string;
    section: string;
  }): Promise<ClassItem> {
    return this.request<ClassItem>('/students/classes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createSubject(data: { department_id: string; code: string; name: string }) {
    return this.request('/sessions/subjects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listLaboratories(): Promise<{ id: string; name: string; room_number: string; building: string; capacity: number }[]> {
    return this.request<{ id: string; name: string; room_number: string; building: string; capacity: number }[]>('/sessions/laboratories');
  }

  async createLaboratory(data: { name: string; room_number: string; building: string; capacity?: number }) {
    return this.request('/sessions/laboratories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // --- Sessions & Timetable ---
  async listSubjects(): Promise<{ id: string; department_id: string; code: string; name: string }[]> {
    return this.request<{ id: string; department_id: string; code: string; name: string }[]>('/sessions/subjects');
  }

  async listSessions(status?: string, classId?: string): Promise<LabSession[]> {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (classId) query.set('class_id', classId);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<LabSession[]>(`/sessions${qs}`);
  }

  async getActiveSession(): Promise<LabSession | null> {
    return this.request<LabSession | null>('/sessions/active');
  }

  async createSession(data: {
    subject_id: string;
    laboratory_id: string;
    class_id: string;
    teacher_id?: string;
    start_time: string;
    end_time: string;
    late_grace_minutes: number;
  }): Promise<LabSession> {
    // No fake laboratory_id: the old code substituted 'lab-gate-01',
    // which matches no row in the database, so sessions were created
    // pointing at a laboratory that does not exist.
    if (!data.laboratory_id) {
      throw new Error('Select a laboratory for this session first.');
    }
    return this.request<LabSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSession(id: string, data: { status_update?: string; late_grace_minutes?: number }): Promise<LabSession> {
    const query = new URLSearchParams();
    if (data.status_update) query.set('status_update', data.status_update);
    if (data.late_grace_minutes != null) query.set('late_grace_minutes', String(data.late_grace_minutes));
    return this.request<LabSession>(`/sessions/${id}?${query.toString()}`, { method: 'PUT' });
  }

  async deleteSession(id: string): Promise<void> {
    return this.request<void>(`/sessions/${id}`, { method: 'DELETE' });
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

  async carryForwardAttendance(sessionId: string): Promise<{
    success: boolean;
    carried_count: number;
    message: string;
  }> {
    return this.request(`/attendance/carry-forward/${sessionId}`, { method: 'POST' });
  }

  // --- Camera ---
  getCameraStreamUrl(): string {
    return `${API_BASE}/camera/stream`;
  }

  getCameraRawStreamUrl(): string {
    return `${API_BASE}/camera/raw-stream`;
  }

  getCameraSnapshotUrl(): string {
    return `${API_BASE}/camera/snapshot?t=${Date.now()}`;
  }

  getCameraRawCaptureUrl(): string {
    return `${API_BASE}/camera/capture-frame?t=${Date.now()}`;
  }

  async captureCameraSnapshotAsFile(filename = 'gate_capture.jpg'): Promise<File> {
    const res = await fetch(`${API_BASE}/camera/capture-frame?t=${Date.now()}`);
    if (!res.ok) {
      throw new Error('Failed to capture frame from live gate camera. Verify camera is connected.');
    }
    const blob = await res.blob();
    return new File([blob], filename, { type: 'image/jpeg' });
  }

  async getCameraStatus() {
    return this.request('/camera/status');
  }

  async reconnectCamera() {
    return this.request('/camera/reconnect', { method: 'POST' });
  }

  async testCamera(config: {
    source_type: string;
    hikvision_ip?: string;
    hikvision_port?: number;
    hikvision_username?: string;
    hikvision_password?: string;
    hikvision_stream?: number;
    rtsp_url?: string;
    webcam_index?: number;
  }): Promise<{ success: boolean; message: string; tested_source: string; resolution?: string }> {
    return this.request('/camera/test', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async configureCamera(config: {
    source_type: string;
    hikvision_ip?: string;
    hikvision_port?: number;
    hikvision_username?: string;
    hikvision_password?: string;
    hikvision_stream?: number;
    rtsp_url?: string;
    webcam_index?: number;
  }): Promise<{ success: boolean; message: string; active_source: string }> {
    return this.request('/camera/configure', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // --- Multi-Camera Devices Management ---
  async listCameras(): Promise<CameraDevice[]> {
    return this.request<CameraDevice[]>('/camera/devices');
  }

  async createCamera(data: {
    name: string;
    source_type: string;
    ip_address?: string;
    port?: number;
    username?: string;
    password?: string;
    stream_channel?: number;
    rtsp_url?: string;
    webcam_index?: number;
    laboratory_id?: string;
  }): Promise<CameraDevice> {
    return this.request<CameraDevice>('/camera/devices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCamera(id: string, data: Partial<CameraDevice>): Promise<CameraDevice> {
    return this.request<CameraDevice>(`/camera/devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCamera(id: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/camera/devices/${id}`, {
      method: 'DELETE',
    });
  }

  async activateCamera(id: string): Promise<{ success: boolean; message: string; active_source: string }> {
    return this.request<{ success: boolean; message: string; active_source: string }>(
      `/camera/devices/${id}/activate`,
      { method: 'POST' }
    );
  }

  // --- CIT Lab Weekly Timetable & Daily Rescheduling ---
  async listTimetableSlots(params?: { day_of_week?: number; class_id?: string }) {
    const q = new URLSearchParams();
    if (params?.day_of_week !== undefined) q.set('day_of_week', String(params.day_of_week));
    if (params?.class_id) q.set('class_id', params.class_id);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return this.request<import('../types').TimetableSlot[]>(`/timetable/slots${qs}`);
  }

  async createTimetableSlot(data: {
    day_of_week: number;
    class_id: string;
    subject_name: string;
    teacher_name: string;
    start_time_str: string;
    end_time_str: string;
    late_grace_minutes: number;
  }) {
    return this.request<import('../types').TimetableSlot>('/timetable/slots', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTimetableSlot(id: string, data: Partial<{
    day_of_week: number;
    class_id: string;
    subject_name: string;
    teacher_name: string;
    start_time_str: string;
    end_time_str: string;
    late_grace_minutes: number;
    is_active: boolean;
  }>) {
    return this.request<import('../types').TimetableSlot>(`/timetable/slots/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTimetableSlot(id: string): Promise<void> {
    await this.request(`/timetable/slots/${id}`, { method: 'DELETE' });
  }

  async getDailySchedule(targetDate?: string) {
    const qs = targetDate ? `?target_date=${encodeURIComponent(targetDate)}` : '';
    return this.request<import('../types').DailySession[]>(`/timetable/today${qs}`);
  }

  async createExtraSession(data: {
    target_date?: string;
    class_id: string;
    subject_name: string;
    teacher_name: string;
    start_time_str: string;
    end_time_str: string;
    late_grace_minutes: number;
    status_note?: string;
  }) {
    return this.request<import('../types').DailySession>('/timetable/today/extra', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async rescheduleSession(sessionId: string, data: {
    target_date?: string;
    start_time_str: string;
    end_time_str: string;
    teacher_name?: string;
    subject_name?: string;
    class_id?: string;
    late_grace_minutes?: number;
    reason: string;
  }) {
    return this.request<import('../types').DailySession>(`/timetable/sessions/${sessionId}/reschedule`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async cancelSession(sessionId: string, reason: string) {
    return this.request<import('../types').DailySession>(`/timetable/sessions/${sessionId}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    });
  }

  async restoreSession(sessionId: string) {
    return this.request<import('../types').DailySession>(`/timetable/sessions/${sessionId}/restore`, {
      method: 'PUT',
    });
  }

  // --- Academic Year Rollover & Bulk JSON Student Import ---
  async getAcademicSummary() {
    return this.request<import('../types').AcademicSummary>('/academic/summary');
  }

  async performAcademicRollover(data: { academic_year_label: string; clear_weekly_timetable: boolean }) {
    return this.request<{
      success: boolean;
      message: string;
      graduated_count: number;
      promoted_to_3rd_count: number;
      promoted_to_2nd_count: number;
      cleared_timetable_slots: number;
    }>('/academic/rollover', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async importStudentsFromFolder(splitFiles = true) {
    return this.request<{
      success: boolean;
      imported: number;
      skipped_duplicates: number;
      per_class: Record<string, number>;
      files_processed: string[];
      split_files_created: string[];
    }>(`/academic/import-from-folder?split_files=${splitFiles}`, {
      method: 'POST',
    });
  }

  async importStudentsJsonFile(file: File, defaultClassName?: string) {
    const formData = new FormData();
    formData.append('file', file);
    const qs = defaultClassName ? `?default_class_name=${encodeURIComponent(defaultClassName)}` : '';
    return this.request<{
      success: boolean;
      imported: number;
      skipped_duplicates: number;
      per_class: Record<string, number>;
    }>(`/academic/import-json${qs}`, {
      method: 'POST',
      body: formData,
    });
  }

  // --- Reports, Analytics & Production Test Archive ---
  async getDashboardStatistics(): Promise<DashboardStatistics> {
    return this.request<DashboardStatistics>('/reports/statistics');
  }

  async getAttendanceAnalytics(params: {
    period: 'today' | 'current_month' | 'previous_month' | 'month' | 'date';
    month?: string;
    target_date?: string;
    class_id?: string;
  }) {
    const q = new URLSearchParams({ period: params.period });
    if (params.month) q.set('month', params.month);
    if (params.target_date) q.set('target_date', params.target_date);
    if (params.class_id) q.set('class_id', params.class_id);
    return this.request<any>(`/reports/analytics?${q.toString()}`);
  }

  async archiveTestRecordsForProduction(batchName?: string) {
    const qs = batchName ? `?batch_name=${encodeURIComponent(batchName)}` : '';
    return this.request<{
      success: boolean;
      archived_count: number;
      batch_name: string;
      message: string;
    }>(`/reports/archive-test-records${qs}`, { method: 'POST' });
  }

  async listArchivedTestRecords() {
    return this.request<Array<{
      id: string;
      archive_batch_name: string;
      archived_at: string;
      session_date: string;
      class_name: string;
      subject_name: string;
      teacher_name: string;
      roll_number: string;
      student_name: string;
      status: string;
      entry_time_12h: string;
      verification_method: string;
      notes: string;
    }>>('/reports/test-archives');
  }

  async getProjectorLiveData() {
    return this.request<any>('/reports/projector-live');
  }

  // CSV export: the old plain <a href> sent no Bearer token, so the
  // export 401'd for everyone. Fetch with the token and download a blob.
  async downloadCsv(sessionId?: string): Promise<void> {
    const url = `${API_BASE}/reports/export/csv${sessionId ? `?session_id=${sessionId}` : ''}`;
    const res = await fetch(url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Export failed (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = sessionId ? `attendance_${sessionId}.csv` : 'attendance_export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async submitCorrection(data: { session_id: string; reason: string; student_id?: string }): Promise<CorrectionRequest> {
    return this.request<CorrectionRequest>('/reports/corrections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listCorrections(): Promise<CorrectionRequest[]> {
    return this.request<CorrectionRequest[]>('/reports/corrections');
  }

  async reviewCorrection(id: string, decision: 'APPROVED' | 'REJECTED', note?: string): Promise<CorrectionRequest> {
    return this.request<CorrectionRequest>(`/reports/corrections/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
  }
}

export const api = new ApiService();
