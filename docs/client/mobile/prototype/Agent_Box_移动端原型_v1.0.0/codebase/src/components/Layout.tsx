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
    if (info.offset.y <= -20) {
      setIsExpanded(true);
    } else if (info.offset.y >= 20 && !isHome) {
      setIsExpanded(false);
    }
  };

  // 压缩高度比例
  const expandedHeight = 56;
  const collapsedHeight = 28;
  const containerPadding = 8;
  
  const currentTabHeight = hideTabBar ? 0 : (isExpanded ? expandedHeight + containerPadding : collapsedHeight + containerPadding);

  return (
    <div 
      className="flex flex-col h-[100dvh] w-full bg-white overflow-hidden relative"
      style={{ '--tab-height': `${currentTabHeight}px` } as React.CSSProperties}
    >
      <div className="flex-1 overflow-hidden relative transition-all duration-300">
        <Outlet />
      </div>
      
      {!hideTabBar && (
        <motion.div 
          className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-2xl rounded-t-2xl flex flex-col z-50 pt-2 border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]"
          initial={false}
          animate={{ height: currentTabHeight }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={handleDragEnd}
          onClick={() => !isExpanded && setIsExpanded(true)}
        >
          {/* Drag Handle / Collapsed State */}
          <div 
            className={cn(
              "w-full flex items-center justify-center cursor-pointer transition-all duration-300",
              isExpanded ? "opacity-0 pointer-events-none h-0 py-0" : "opacity-100 h-6 pb-2"
            )}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full" />
          </div>
          
          {/* Expanded Tabs */}
          <div className={cn(
            "flex justify-around items-center px-4 w-full absolute bottom-0 pb-2 transition-opacity duration-300",
            isExpanded ? "opacity-100 h-[56px]" : "opacity-0 pointer-events-none h-[56px]"
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
                    "flex flex-col items-center justify-center w-16 h-12 transition-all duration-300",
                    isActive ? "text-[#6b46c1] scale-110" : "text-gray-400 hover:text-gray-600 hover:scale-105"
                  )}
                >
                  <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
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