import React from 'react';
import { ChevronRight, Server, Key, Database, Wrench, Mic, LayoutGrid, Settings as SettingsIcon, FileText, HelpCircle, Bot } from 'lucide-react';

const Settings = () => {
  const menuGroups = [
    {
      title: '核心配置',
      items: [
        { icon: Bot, label: 'Agent 设置', active: true },
        { icon: Server, label: 'Providers', value: '9 个可用' },
        { icon: SettingsIcon, label: 'Model Service' },
        { icon: Key, label: 'OAuth' },
        { icon: Database, label: 'Memory & Embedding' },
      ]
    },
    {
      title: '功能扩展',
      items: [
        { icon: Wrench, label: 'Skills' },
        { icon: Mic, label: 'Voice' },
        { icon: LayoutGrid, label: 'Applets' },
      ]
    },
    {
      title: '系统',
      items: [
        { icon: SettingsIcon, label: 'General' },
        { icon: FileText, label: 'Logs' },
        { icon: HelpCircle, label: 'Help & About' },
      ]
    }
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="px-5 pt-14 pb-4">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">设置</h1>
      </div>

      <div 
        className="flex-1 overflow-y-auto px-5 space-y-8"
        style={{ paddingBottom: 'calc(2rem + var(--tab-height, 0px))' }}
      >
        {/* User Profile Card */}
        <div className="bg-white rounded-3xl p-5 flex items-center gap-4 shadow-sm border border-gray-100">
          <div className="w-16 h-16 bg-[#6b46c1] rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-md shadow-purple-200">
            A
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Peers-Touch User</h2>
            <p className="text-[15px] text-gray-500 font-medium mt-0.5">Free Plan</p>
          </div>
          <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center">
            <ChevronRight size={20} className="text-gray-400" />
          </div>
        </div>

        {/* Settings Groups */}
        <div className="space-y-6">
          {menuGroups.map((group, idx) => (
            <div key={idx}>
              <h3 className="text-[13px] font-bold text-gray-400 uppercase tracking-wider mb-3 ml-2">{group.title}</h3>
              <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100">
                {group.items.map((item, itemIdx) => (
                  <div 
                    key={itemIdx}
                    className={`flex items-center gap-4 p-4 active:bg-gray-50 transition-colors cursor-pointer ${
                      itemIdx !== group.items.length - 1 ? 'border-b border-gray-50' : ''
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      item.active ? 'bg-purple-50 text-[#6b46c1]' : 'bg-gray-50 text-gray-500'
                    }`}>
                      <item.icon size={20} />
                    </div>
                    <span className="flex-1 text-[16px] font-semibold text-gray-800">{item.label}</span>
                    {item.value && (
                      <span className="text-[14px] font-medium text-gray-400">{item.value}</span>
                    )}
                    <ChevronRight size={20} className="text-gray-300" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <div className="pt-2">
          <button className="w-full bg-white text-red-500 text-[16px] font-bold py-4 rounded-3xl shadow-sm border border-gray-100 active:bg-gray-50 transition-colors">
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;