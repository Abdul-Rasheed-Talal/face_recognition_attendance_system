export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'ADMIN' | 'TEACHER' | 'OPERATOR';
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  role: string;
  full_name: string;
  user_id: string;
}

export interface Student {
  id: string;
  roll_number: string;
  full_name: string;
  email: string;
  department_id: string;
  class_id: string;
  status: string;
  is_face_enrolled: boolean;
  created_at: string;
}

export interface LabSession {
  id: string;
  subject_name: string;
  subject_code: string;
  laboratory_name: string;
  room_number: string;
  teacher_name: string;
  class_name: string;
  start_time: string;
  end_time: string;
  late_grace_minutes: number;
  status: string;
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  student_id: string;
  student_name: string;
  roll_number: string;
  timestamp: string;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' | 'MANUAL_CORRECTION';
  confidence_score?: number;
  verification_method: string;
  notes?: string;
}

export interface CameraHealth {
  camera_connected: boolean;
  camera_source: string;
  ingestion_fps: number;
  processing_fps: number;
  reconnect_attempts: number;
  dropped_frames: number;
  pipeline_latency_ms: number;
  enrolled_students_in_gallery: number;
  active_tracks_count: number;
  last_error?: string;
}

export interface DashboardStatistics {
  total_students: number;
  present_today: number;
  late_today: number;
  absent_today: number;
  overall_attendance_pct: number;
  active_session?: {
    session_id: string;
    status: string;
    start_time: string;
    end_time: string;
  };
  camera_health: CameraHealth;
}

export interface LiveAttendanceEvent {
  type: string;
  record_id: string;
  student_id: string;
  student_name: string;
  roll_number: string;
  session_id: string;
  status: string;
  confidence: number;
  timestamp: string;
}

export interface CorrectionRequest {
  id: string;
  student_id: string;
  student_name: string;
  roll_number: string;
  session_id: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
}

