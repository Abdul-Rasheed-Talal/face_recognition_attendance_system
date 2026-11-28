import React from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  CalendarCheck,
  Users,
  Video,
  Layers,
  CheckCircle2,
  GraduationCap,
  BarChart3,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'analytics' | 'timetable' | 'attendance' | 'students' | 'academic' | 'camera';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Gate Monitor',
      description: 'Live camera & instant entry log',
      icon: LayoutDashboard,
    },
    {
      id: 'analytics' as NavTab,
      label: 'Analytics & History',
      description: 'Graphs, monthly register & reset',
      icon: BarChart3,
    },
    {
      id: 'timetable' as NavTab,
      label: 'Lab Timetable',
      description: 'Weekly slots & rescheduling',
      icon: CalendarDays,
    },
    {
      id: 'attendance' as NavTab,
      label: 'Attendance Records',
      description: 'Lab logs & CSV export',
      icon: CalendarCheck,
    },
    {
      id: 'students' as NavTab,
      label: 'CIT Students & Photos',
      description: 'Roster & live camera capture',
      icon: Users,
    },
    {
      id: 'academic' as NavTab,
      label: 'Academic Year & Import',
      description: 'Class promotion & JSON import',
      icon: GraduationCap,
    },
    {
      id: 'camera' as NavTab,
      label: 'Gate Camera Setup',
      description: 'IP camera & stream settings',
      icon: Video,
    },
  ];

  return (
    <aside className="w-64 bg-white border-r border-stone-200 p-4 flex flex-col justify-between shrink-0">
      <div>
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          <span>CIT Lab Menu</span>
        </div>

        <nav className="mt-2 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl transition flex items-start gap-3 cursor-pointer ${
                  isActive
                    ? 'bg-stone-900 text-white shadow-xs'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${isActive ? 'text-white' : 'text-stone-500'}`} />
                <div>
                  <div className={`text-xs font-semibold leading-tight ${isActive ? 'text-white' : 'text-stone-800'}`}>
                    {item.label}
                  </div>
                  <div className={`text-[11px] mt-0.5 leading-snug ${isActive ? 'text-stone-300' : 'text-stone-500'}`}>
                    {item.description}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* System Status Footnote */}
      <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 text-xs">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 mb-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>CIT Computer Lab</span>
        </div>
        <p className="text-[11px] text-stone-500 leading-relaxed">
          Tracks CIT 1st, 2nd &amp; 3rd Year lab classes automatically according to the active lab timetable.
        </p>
      </div>
    </aside>
  );
};
