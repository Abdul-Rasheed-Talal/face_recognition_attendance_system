import React, { useState, useEffect } from 'react';
import {
  Camera,
  Video,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ExternalLink,
  Shield,
  Activity,
  Zap,
  Radio,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import { CameraDevice, CameraHealth, User } from '../types';
import { api } from '../services/api';

interface CamerasViewProps {
  currentUser: User | null;
  onOpenLogin: () => void;
  cameraHealth?: CameraHealth;
}

export const CamerasView: React.FC<CamerasViewProps> = ({
  currentUser,
  onOpenLogin,
  cameraHealth,
}) => {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Camera Form States
  const [sourceType, setSourceType] = useState<'hikvision' | 'rtsp' | 'webcam'>('hikvision');
  const [name, setName] = useState('');
  const [ip, setIp] = useState('192.168.1.218');
  const [port, setPort] = useState(554);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [streamChannel, setStreamChannel] = useState(101);
  const [customRtsp, setCustomRtsp] = useState('');
  const [webcamIndex, setWebcamIndex] = useState(0);

  // Testing & Submitting
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; resolution?: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Action status feedback
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const fetchCameras = async () => {
    setIsLoading(true);
    try {
      const data = await api.listCameras();
      setCameras(data);
    } catch (e: any) {
      console.error('Failed to load cameras:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handleTestInModal = async () => {
    setIsTesting(true);
    setTestResult(null);
    setFormError(null);
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
      setIsTesting(false);
    }
  };

  const handleCreateCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenLogin();
      return;
    }

    if (!name.trim()) {
      setFormError('Camera name is required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await api.createCamera({
        name: name.trim(),
        source_type: sourceType,
        ip_address: ip,
        port,
        username,
        password,
        stream_channel: streamChannel,
        rtsp_url: customRtsp,
        webcam_index: webcamIndex,
      });

      setIsAddModalOpen(false);
      setName('');
      setPassword('');
      setTestResult(null);
      setActionMsg({ type: 'success', text: `Camera '${name}' registered successfully.` });
      fetchCameras();
      setTimeout(() => setActionMsg(null), 3000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create camera device.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivateCamera = async (cam: CameraDevice) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    setActivatingId(cam.id);
    try {
      await api.activateCamera(cam.id);
      setActionMsg({
        type: 'success',
        text: `Switched AI recognition engine to ingest from: ${cam.name}`,
      });
      fetchCameras();
      setTimeout(() => setActionMsg(null), 3500);
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to activate camera.' });
    } finally {
      setActivatingId(null);
    }
  };

  const handleDeleteCamera = async (cam: CameraDevice) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    if (!window.confirm(`Permanently remove camera device '${cam.name}'?`)) return;

    try {
      await api.deleteCamera(cam.id);
      setActionMsg({ type: 'success', text: `Camera '${cam.name}' removed.` });
      fetchCameras();
      setTimeout(() => setActionMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to delete camera.');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Banner / Feedback */}
      {actionMsg && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between shadow-md transition ${
            actionMsg.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300'
              : 'bg-rose-950/60 border-rose-500/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            <span className="font-semibold">{actionMsg.text}</span>
          </div>
          <button onClick={() => setActionMsg(null)} className="p-1 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Staff Authentication notice if guest */}
      {!currentUser && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/70 to-slate-800 border border-indigo-700/60 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Administrator Access Required for Camera Provisioning</div>
              <p className="text-[11px] text-slate-300">
                Sign in to register additional IP cameras, switch active feeds, or adjust RTSP settings.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/30 transition shrink-0"
          >
            Sign In
          </button>
        </div>
      )}

      {/* Active Stream Telemetry Status Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950/50 border border-slate-700/80 p-5 rounded-2xl shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Radio className={`w-5 h-5 ${cameraHealth?.camera_connected ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Active AI Ingestion Stream</h2>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    cameraHealth?.camera_connected
                      ? 'bg-emerald-950/80 border border-emerald-500/60 text-emerald-300'
                      : 'bg-rose-950/80 border border-rose-500/60 text-rose-300'
                  }`}
                >
                  {cameraHealth?.camera_connected ? 'Online & Ingesting' : 'Stream Pending / Offline'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono truncate max-w-xl">
                Source: {cameraHealth?.camera_source ?? 'Default Ingestion Source'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-stretch sm:self-auto justify-end">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-white">{cameraHealth?.ingestion_fps ?? 0} FPS</div>
              <div className="text-[10px] text-slate-400">{cameraHealth?.pipeline_latency_ms ?? 0} ms Latency</div>
            </div>
            <button
              onClick={() => {
                if (!currentUser) { onOpenLogin(); return; }
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/30 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add IP Camera</span>
            </button>
          </div>
        </div>
      </div>

      {/* Camera Grid Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">Configured IP Cameras ({cameras.length})</h3>
          <p className="text-xs text-slate-400">Manage laboratory entrance cameras and video feeds</p>
        </div>
        <button
          onClick={fetchCameras}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 rounded-xl border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Cameras Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cameras.map((cam) => {
          const isActive = cam.is_active;
          return (
            <div
              key={cam.id}
              className={`p-5 rounded-2xl border transition shadow-sm flex flex-col justify-between ${
                isActive
                  ? 'bg-slate-800/90 border-indigo-500/80 shadow-indigo-500/10'
                  : 'bg-slate-850/80 border-slate-700/70 hover:border-slate-600'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        isActive
                          ? 'bg-indigo-600/30 border border-indigo-500 text-indigo-300'
                          : 'bg-slate-800 border border-slate-700 text-slate-400'
                      }`}
                    >
                      <Camera className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white leading-tight">{cam.name}</h4>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {cam.ip_address ? `IP: ${cam.ip_address}:${cam.port}` : 'Local Source'}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      isActive
                        ? 'bg-emerald-950/70 border border-emerald-600 text-emerald-400'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {isActive ? 'Active AI Feed' : 'Standby'}
                  </span>
                </div>

                {/* Stream URL snippet */}
                <div className="bg-slate-900/80 rounded-xl p-2.5 border border-slate-700/50 mb-3">
                  <div className="text-[10px] text-slate-400 flex items-center justify-between mb-1">
                    <span>RTSP Connection Path</span>
                    {cam.ip_address && (
                      <a
                        href={`http://${cam.ip_address}/doc/page/preview.asp`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:underline flex items-center gap-1 text-[9px]"
                      >
                        Web Preview <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-300 truncate">
                    {cam.rtsp_url.includes('@') ? (
                      `rtsp://***:***@${cam.rtsp_url.split('@')[1]}`
                    ) : (
                      cam.rtsp_url
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="pt-3 border-t border-slate-700/60 flex items-center justify-between gap-2">
                {!isActive ? (
                  <button
                    onClick={() => handleActivateCamera(cam)}
                    disabled={activatingId === cam.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>{activatingId === cam.id ? 'Switching...' : 'Set as Active Feed'}</span>
                  </button>
                ) : (
                  <div className="flex-1 flex items-center gap-1 text-[11px] text-emerald-400 font-semibold py-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Currently Ingesting</span>
                  </div>
                )}

                <button
                  onClick={() => handleDeleteCamera(cam)}
                  className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
                  title="Delete Camera"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Camera Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-700/80 flex items-center justify-between bg-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Video className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add IP Camera Device</h3>
                  <p className="text-[11px] text-slate-400">Connect a new entrance camera or RTSP stream</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCamera} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
                  {formError}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Camera Display Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Computer Lab Entrance Gate 1"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Source Type Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-2">Camera Protocol / Brand</label>
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
                    Hikvision IP
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
                    Generic RTSP
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
                <div className="space-y-3 rounded-xl bg-slate-800/40 p-4 border border-slate-700/60">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="text-[11px] font-medium text-slate-400 block mb-1">IP Address</label>
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
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">Stream Channel</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setStreamChannel(101)}
                        className={`p-2 rounded-lg border text-left text-xs transition ${
                          streamChannel === 101 ? 'bg-indigo-600/30 border-indigo-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'
                        }`}
                      >
                        <div className="font-semibold">Channel 101</div>
                        <div className="text-[10px] text-slate-400">1080p Main Stream</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStreamChannel(102)}
                        className={`p-2 rounded-lg border text-left text-xs transition ${
                          streamChannel === 102 ? 'bg-indigo-600/30 border-indigo-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'
                        }`}
                      >
                        <div className="font-semibold">Channel 102</div>
                        <div className="text-[10px] text-slate-400">Sub Stream (Low Latency)</div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {sourceType === 'rtsp' && (
                <div className="space-y-3 rounded-xl bg-slate-800/40 p-4 border border-slate-700/60">
                  <label className="text-[11px] font-medium text-slate-400 block">RTSP Connection URL</label>
                  <input
                    type="text"
                    value={customRtsp}
                    onChange={(e) => setCustomRtsp(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    placeholder="rtsp://admin:pass@192.168.1.100:554/stream"
                  />
                </div>
              )}

              {sourceType === 'webcam' && (
                <div className="space-y-3 rounded-xl bg-slate-800/40 p-4 border border-slate-700/60">
                  <label className="text-[11px] font-medium text-slate-400 block">Webcam Index</label>
                  <input
                    type="number"
                    value={webcamIndex}
                    onChange={(e) => setWebcamIndex(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                    min="0"
                    max="5"
                  />
                </div>
              )}

              {/* Test Connection result */}
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
                    <div className="font-semibold">{testResult.success ? 'Stream Validated!' : 'Connection Failed'}</div>
                    <div className="text-[11px] mt-0.5 opacity-90">{testResult.message}</div>
                    {testResult.resolution && (
                      <div className="text-[10px] font-mono mt-1 text-emerald-400">
                        Resolution: {testResult.resolution}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between border-t border-slate-700/60">
                <button
                  type="button"
                  onClick={handleTestInModal}
                  disabled={isTesting || isSubmitting}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl border border-slate-700 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || isTesting}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl shadow-md transition disabled:opacity-50"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Camera'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

