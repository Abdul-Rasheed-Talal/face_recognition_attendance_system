import React from 'react';
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  GraduationCap,
  Cpu,
  Layers,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'attendance' | 'students' | 'portal' | 'system';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  userRole?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, userRole }) => {
  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Live Dashboard',
      description: 'Camera feed & instant metrics',
      icon: LayoutDashboard,
    },
    {
      id: 'attendance' as NavTab,
      label: 'Attendance Records',
      description: 'Session logs & manual override',
      icon: CalendarCheck,
    },
    {
      id: 'students' as NavTab,
      label: 'Students & Enrollment',
      description: 'Biometric face registration',
      icon: Users,
    },
    {
      id: 'portal' as NavTab,
      label: 'Student Portal',
      description: 'Self-service history & disputes',
      icon: GraduationCap,
    },
    {
      id: 'system' as NavTab,
      label: 'Edge CPU Telemetry',
      description: 'OpenCV YuNet & SFace health',
      icon: Cpu,
    },
  ];

  return (
    <aside className="w-64 bg-slate-800/50 border-r border-slate-700/60 p-4 flex flex-col justify-between shrink-0">
      <div>
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          <span>Navigation</span>
        </div>

        <nav className="mt-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full text-left px-3.5 py-3 rounded-xl transition flex items-start gap-3 ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600/90 to-indigo-700 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <div>
                  <div className="text-xs font-semibold leading-tight">{item.label}</div>
                  <div className={`text-[10px] mt-0.5 leading-snug ${isActive ? 'text-indigo-100' : 'text-slate-400'}`}>
                    {item.description}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Edge Model Baseline Tag */}
      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-700/60 text-xs">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
          <span>Inference Engine</span>
          <span className="text-emerald-400 font-mono font-medium">ONNX CPU</span>
        </div>
        <div className="space-y-1 text-[11px] text-slate-300">
          <div className="flex justify-between">
            <span className="text-slate-400">Detector:</span>
            <span className="font-mono text-indigo-300">OpenCV YuNet</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Recognizer:</span>
            <span className="font-mono text-cyan-300">OpenCV SFace</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">License:</span>
            <span className="text-emerald-400 font-medium">Apache 2.0</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

