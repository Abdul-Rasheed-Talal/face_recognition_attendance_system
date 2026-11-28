import React, { useState } from 'react';
import {
  Video,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Camera,
  Play,
  Activity,
  Sliders,
} from 'lucide-react';
import { CameraHealth } from '../types';
import { api } from '../services/api';

interface GateCameraSettingsProps {
  cameraHealth?: CameraHealth;
  onRefresh?: () => void;
}

export const GateCameraSettings: React.FC<GateCameraSettingsProps> = ({
  cameraHealth,
  onRefresh,
}) => {
  const [sourceType, setSourceType] = useState<'hikvision' | 'webcam' | 'rtsp'>('hikvision');

  // Hikvision settings
  const [hikvisionIp, setHikvisionIp] = useState('192.168.1.218');
  const [hikvisionPort, setHikvisionPort] = useState(554);
  const [hikvisionUser, setHikvisionUser] = useState('admin');
  const [hikvisionPass, setHikvisionPass] = useState('Gct@1122');
  const [hikvisionStream, setHikvisionStream] = useState<number>(101);

  // Webcam & RTSP settings
  const [webcamIndex, setWebcamIndex] = useState(0);
  const [rtspUrl, setRtspUrl] = useState('');

  // Status & Testing feedback
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; resolution?: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const isConnected = cameraHealth?.camera_connected ?? false;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testCamera({
        source_type: sourceType,
        hikvision_ip: hikvisionIp,
        hikvision_port: Number(hikvisionPort),
        hikvision_username: hikvisionUser,
        hikvision_password: hikvisionPass,
        hikvision_stream: Number(hikvisionStream),
        webcam_index: Number(webcamIndex),
        rtsp_url: rtspUrl,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test failed. Verify camera power and IP address.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleApplyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const res = await api.configureCamera({
        source_type: sourceType,
        hikvision_ip: hikvisionIp,
        hikvision_port: Number(hikvisionPort),
        hikvision_username: hikvisionUser,
        hikvision_password: hikvisionPass,
        hikvision_stream: Number(hikvisionStream),
        webcam_index: Number(webcamIndex),
        rtsp_url: rtspUrl,
      });
      setSaveMessage('Camera source updated successfully! Connecting to stream...');
      if (onRefresh) setTimeout(onRefresh, 1500);
    } catch (err: any) {
      setSaveMessage(err.message || 'Failed to update camera source.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleForceReconnect = async () => {
    try {
      await api.reconnectCamera();
      setSaveMessage('Reconnection signal sent to camera reader.');
      if (onRefresh) setTimeout(onRefresh, 1200);
    } catch (err: any) {
      setSaveMessage(err.message || 'Failed to trigger reconnect.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Top Header */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Video className="w-5 h-5 text-stone-800" />
            <h2 className="text-lg font-bold text-stone-900 tracking-tight">Gate Camera Configuration</h2>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Configure the camera positioned at the entrance gate. Supports dedicated Hikvision IP cameras, standard RTSP video feeds, and USB webcams.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleForceReconnect}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-semibold border border-stone-200 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Force Reconnect</span>
          </button>
        </div>
      </div>

      {/* Current Camera Status Card */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-sm font-bold text-stone-900">
              {isConnected ? 'Gate Camera is Streaming Online' : 'Gate Camera is Offline / Connecting'}
            </span>
          </div>

          <span
            className={`text-xs font-bold px-3 py-0.5 rounded-full ${
              isConnected
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
            <div className="text-[11px] text-stone-500 font-medium">Ingestion FPS</div>
            <div className="text-base font-bold text-stone-900 mt-0.5">
              {cameraHealth?.ingestion_fps ?? 0} FPS
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
            <div className="text-[11px] text-stone-500 font-medium">Processing FPS</div>
            <div className="text-base font-bold text-stone-900 mt-0.5">
              {cameraHealth?.processing_fps ?? 10} FPS
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
            <div className="text-[11px] text-stone-500 font-medium">Pipeline Latency</div>
            <div className="text-base font-bold text-stone-900 mt-0.5">
              {cameraHealth?.pipeline_latency_ms ? `${cameraHealth.pipeline_latency_ms} ms` : '&lt;100 ms'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
            <div className="text-[11px] text-stone-500 font-medium">Active Enrolled Faces</div>
            <div className="text-base font-bold text-emerald-700 mt-0.5">
              {cameraHealth?.enrolled_students_in_gallery ?? 0} Students
            </div>
          </div>
        </div>

        {cameraHealth?.last_error && !isConnected && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{cameraHealth.last_error}</span>
          </div>
        )}
      </div>

      {/* Camera Settings Form */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
        <h3 className="text-sm font-bold text-stone-900 mb-4 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-stone-700" />
          <span>Camera Hardware Connection</span>
        </h3>

        {saveMessage && (
          <div className="mb-4 p-3 rounded-xl bg-stone-100 border border-stone-200 text-xs text-stone-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveMessage}</span>
          </div>
        )}

        <form onSubmit={handleApplyConfig} className="space-y-5">
          {/* Source Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-2">Camera Type</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setSourceType('hikvision')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  sourceType === 'hikvision'
                    ? 'bg-stone-900 text-white border-stone-900 shadow-xs'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                <div className="text-xs font-bold">Hikvision IP Camera</div>
                <div className={`text-[11px] mt-0.5 ${sourceType === 'hikvision' ? 'text-stone-300' : 'text-stone-500'}`}>
                  RTSP with user & password
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('webcam')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  sourceType === 'webcam'
                    ? 'bg-stone-900 text-white border-stone-900 shadow-xs'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                <div className="text-xs font-bold">Laptop / USB Camera</div>
                <div className={`text-[11px] mt-0.5 ${sourceType === 'webcam' ? 'text-stone-300' : 'text-stone-500'}`}>
                  Direct hardware device index
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('rtsp')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  sourceType === 'rtsp'
                    ? 'bg-stone-900 text-white border-stone-900 shadow-xs'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                <div className="text-xs font-bold">Custom RTSP URL</div>
                <div className={`text-[11px] mt-0.5 ${sourceType === 'rtsp' ? 'text-stone-300' : 'text-stone-500'}`}>
                  Direct stream URL
                </div>
              </button>
            </div>
          </div>

          {/* Hikvision Detailed Fields */}
          {sourceType === 'hikvision' && (
            <div className="space-y-4 pt-2 border-t border-stone-100">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Camera IP Address</label>
                  <input
                    type="text"
                    required
                    value={hikvisionIp}
                    onChange={(e) => setHikvisionIp(e.target.value)}
                    placeholder="192.168.1.218"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">RTSP Port</label>
                  <input
                    type="number"
                    required
                    value={hikvisionPort}
                    onChange={(e) => setHikvisionPort(Number(e.target.value))}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={hikvisionUser}
                    onChange={(e) => setHikvisionUser(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={hikvisionPass}
                    onChange={(e) => setHikvisionPass(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Stream Channel</label>
                <select
                  value={hikvisionStream}
                  onChange={(e) => setHikvisionStream(Number(e.target.value))}
                  className="w-full md:w-64 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 focus:outline-none focus:border-stone-400"
                >
                  <option value={101}>Channel 101 (Main Stream - High Res 1080p)</option>
                  <option value={102}>Channel 102 (Sub Stream - Fast Low-Latency / Recommended)</option>
                </select>
                <p className="text-[11px] text-stone-500 mt-1">
                  Tip: Sub-Stream (Channel 102) significantly reduces CPU decoding lag and eliminates stream stutters.
                </p>
              </div>
            </div>
          )}

          {/* Webcam Fields */}
          {sourceType === 'webcam' && (
            <div className="pt-2 border-t border-stone-100">
              <label className="block text-xs font-semibold text-stone-700 mb-1">Device Index</label>
              <input
                type="number"
                min={0}
                max={5}
                value={webcamIndex}
                onChange={(e) => setWebcamIndex(Number(e.target.value))}
                className="w-32 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900"
              />
              <p className="text-[11px] text-stone-500 mt-1">0 is usually built-in webcam, 1 is external USB camera.</p>
            </div>
          )}

          {/* Custom RTSP URL */}
          {sourceType === 'rtsp' && (
            <div className="pt-2 border-t border-stone-100">
              <label className="block text-xs font-semibold text-stone-700 mb-1">RTSP Stream URL</label>
              <input
                type="text"
                required
                value={rtspUrl}
                onChange={(e) => setRtspUrl(e.target.value)}
                placeholder="rtsp://admin:password@192.168.1.218:554/live/ch0"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-xs text-stone-900 font-mono"
              />
            </div>
          )}

          {/* Test Connection Result Banner */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-bold">{testResult.success ? 'Camera Verified!' : 'Connection Probe Failed'}</div>
                <div className="mt-0.5">{testResult.message}</div>
                {testResult.resolution && (
                  <div className="font-mono text-[11px] mt-1 opacity-80">Stream Resolution: {testResult.resolution}</div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-4 flex items-center justify-between border-t border-stone-100">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-semibold border border-stone-200 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 text-stone-600" />
              <span>{isTesting ? 'Probing Camera...' : 'Test Connection'}</span>
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Connecting Camera...' : 'Save & Connect Gate Camera'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
