import React, { useState } from 'react';
import { Camera, Shield, CheckCircle2, AlertCircle, RefreshCw, X, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { api } from '../services/api';

interface CameraConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigApplied: () => void;
  currentSource?: string;
}

export const CameraConfigModal: React.FC<CameraConfigModalProps> = ({
  isOpen,
  onClose,
  onConfigApplied,
  currentSource,
}) => {
  const [sourceType, setSourceType] = useState<'hikvision' | 'rtsp' | 'webcam'>('hikvision');
  const [ip, setIp] = useState('192.168.1.218');
  const [port, setPort] = useState(554);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [streamChannel, setStreamChannel] = useState(101);
  const [customRtsp, setCustomRtsp] = useState('');
  const [webcamIndex, setWebcamIndex] = useState(0);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    resolution?: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setSaveError(null);
    try {
      const res = await api.testCamera({
        source_type: sourceType,
        hikvision_ip: ip,
        hikvision_port: port,
        hikvision_username: username,
        hikvision_password: password,
        hikvision_stream: streamChannel,
        rtsp_url: customRtsp,
        webcam_index: webcamIndex,
      });
      setTestResult(res);
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleApply = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.configureCamera({
        source_type: sourceType,
        hikvision_ip: ip,
        hikvision_port: port,
        hikvision_username: username,
        hikvision_password: password,
        hikvision_stream: streamChannel,
        rtsp_url: customRtsp,
        webcam_index: webcamIndex,
      });
      onConfigApplied();
      onClose();
    } catch (e: any) {
      setSaveError(e.message || 'Failed to apply camera configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700/80 flex items-center justify-between bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Camera & RTSP Integration</h3>
              <p className="text-xs text-slate-400">Configure Hikvision IP camera or video feed</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Source Type Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-2">Video Feed Source</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => { setSourceType('hikvision'); setTestResult(null); }}
                className={`py-2 px-3 rounded-xl border text-xs font-medium transition ${
                  sourceType === 'hikvision'
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Hikvision Camera
              </button>
              <button
                type="button"
                onClick={() => { setSourceType('rtsp'); setTestResult(null); }}
                className={`py-2 px-3 rounded-xl border text-xs font-medium transition ${
                  sourceType === 'rtsp'
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Custom RTSP
              </button>
              <button
                type="button"
                onClick={() => { setSourceType('webcam'); setTestResult(null); }}
                className={`py-2 px-3 rounded-xl border text-xs font-medium transition ${
                  sourceType === 'webcam'
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                USB Webcam
              </button>
            </div>
          </div>

          {/* Hikvision Form */}
          {sourceType === 'hikvision' && (
            <div className="space-y-4 rounded-xl bg-slate-800/40 p-4 border border-slate-700/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Hikvision Device Settings</span>
                <a
                  href={`http://${ip}/doc/page/preview.asp`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                >
                  <span>Open Web Preview</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">Camera IP Address</label>
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="192.168.1.218"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">RTSP Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="554"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    placeholder="admin"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 pr-8 text-xs text-white focus:outline-none focus:border-indigo-500"
                      placeholder="Camera password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">RTSP Channel Stream</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStreamChannel(101)}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      streamChannel === 101
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">Channel 101 (Main)</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Full 1080p Resolution</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStreamChannel(102)}
                    className={`p-2.5 rounded-lg border text-left transition ${
                      streamChannel === 102
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">Channel 102 (Sub)</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Low Latency / High FPS</div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Custom RTSP Form */}
          {sourceType === 'rtsp' && (
            <div className="space-y-3 rounded-xl bg-slate-800/40 p-4 border border-slate-700/60">
              <label className="text-[11px] font-medium text-slate-400 block">RTSP Connection URL</label>
              <input
                type="text"
                value={customRtsp}
                onChange={(e) => setCustomRtsp(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="rtsp://admin:password@192.168.1.218:554/Streaming/Channels/101"
              />
              <p className="text-[10px] text-slate-400">
                Supports standard RTSP streams over TCP transport with H.264 video encoding.
              </p>
            </div>
          )}

          {/* USB Webcam Form */}
          {sourceType === 'webcam' && (
            <div className="space-y-3 rounded-xl bg-slate-800/40 p-4 border border-slate-700/60">
              <label className="text-[11px] font-medium text-slate-400 block">Webcam Device Index</label>
              <input
                type="number"
                value={webcamIndex}
                onChange={(e) => setWebcamIndex(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="0"
                min="0"
                max="5"
              />
              <p className="text-[10px] text-slate-400">
                0 is typically the built-in laptop webcam, 1 is the first external USB camera.
              </p>
            </div>
          )}

          {/* Test Result Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-semibold">{testResult.success ? 'Camera Verified!' : 'Connection Failed'}</div>
                <div className="text-[11px] mt-0.5 opacity-90">{testResult.message}</div>
                {testResult.resolution && (
                  <div className="text-[10px] font-mono mt-1 text-emerald-400">
                    Resolution: {testResult.resolution}
                  </div>
                )}
              </div>
            </div>
          )}

          {saveError && (
            <div className="p-3 rounded-xl border border-rose-500/50 bg-rose-950/40 text-xs text-rose-300">
              {saveError}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-700/80 bg-slate-800/50 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-slate-200 rounded-xl transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
            <span>{testing ? 'Testing Camera...' : 'Test Connection'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={saving || testing}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl transition shadow-lg shadow-indigo-600/30 disabled:opacity-50"
            >
              {saving ? 'Applying...' : 'Apply & Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

