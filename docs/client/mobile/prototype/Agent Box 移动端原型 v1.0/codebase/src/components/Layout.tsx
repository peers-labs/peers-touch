import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Home, MessageSquare, Bot, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, PanInfo } from 'framer-motion';

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isHome = location.pathname.startsWith('/home');
  const [isExpanded, setIsExpanded] = useState(isHome);

  useEffect(() => {
    if (isHome) {
      setIsExpanded(true);
    } else {
      setIsExpanded(false);
    }
  }, [location.pathname, isHome]);

  const tabs = [
    { id: 'home', path: '/home', icon: Home, label: '首页' },
    { id: 'im', path: '/im', icon: MessageSquare, label: '消息' },
    { id: 'ai', path: '/ai', icon: Bot, label: 'AI助手' },
    { id: 'settings', path: '/settings', icon: Settings, label: '设置' },
  ];

  const hideTabBar = location.pathname === '/login' || location.pathname.startsWith('/im/chat') || location.pathname.startsWith('/im/add-friend');

  const handleDragEnd = (event: any, info: PanInfo) => {
    if (info.offset.y < -20) {
      setIsExpanded(true);
    } else if (info.offset.y > 20 && !isHome) {
      setIsExpanded(false);
    }
  };

  // 增加高度以适配 iOS 底部手势条
  const expandedHeight = 100;
  const collapsedHeight = 48;

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 overflow-hidden relative">
      <div 
        className="flex-1 overflow-y-auto transition-all duration-300"
        style={{ paddingBottom: hideTabBar ? 0 : (isExpanded ? expandedHeight : collapsedHeight) }}
      >
        <Outlet />
      </div>
      
      {!hideTabBar && (
        <motion.div 
          className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 rounded-t-3xl shadow-[0_-4px_20px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden z-50"
          initial={false}
          animate={{ height: isExpanded ? expandedHeight : collapsedHeight }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={handleDragEnd}
          onClick={() => !isExpanded && setIsExpanded(true)}
        >
          {/* Drag Handle / Collapsed State */}
          <div 
            className={cn(
              "w-full flex items-center justify-center cursor-pointer transition-all duration-300 pt-3 pb-2",
              isExpanded ? "opacity-0 pointer-events-none h-0 py-0" : "opacity-100 h-12"
            )}
          >
            <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
          </div>
          
          {/* Expanded Tabs */}
          <div className={cn(
            "flex justify-around items-start pt-4 px-2 w-full absolute bottom-0 transition-opacity duration-300",
            isExpanded ? "opacity-100 h-[100px]" : "opacity-0 pointer-events-none h-[100px]"
          )}>
            {tabs.map((tab) => {
              const isActive = location.pathname.startsWith(tab.path);
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(tab.path);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center w-16 gap-1.5 transition-colors",
                    isActive ? "text-[#6b46c1]" : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default Layout;