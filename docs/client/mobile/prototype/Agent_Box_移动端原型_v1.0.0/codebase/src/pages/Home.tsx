import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Bot, Globe, Terminal, ChevronRight, ScanLine, MoreHorizontal, Code, Cpu, Database, Cloud, Zap, User, Pin, Settings2, X, Activity } from 'lucide-react';
import { motion, useAnimation, PanInfo } from 'framer-motion';

const Home = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isAppletsOpen = searchParams.get('applets') === 'open';
  const controls = useAnimation();

  const [isEditingPins, setIsEditingPins] = useState(false);
  const [isEditingTracking, setIsEditingTracking] = useState(false);
  const pinPressTimer = useRef<NodeJS.Timeout | null>(null);
  const trackingPressTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isAppletsOpen) {
      controls.start({ 
        y: '75vh', 
        borderTopLeftRadius: 40,
        borderTopRightRadius: 40,
        transition: { type: 'spring', damping: 25, stiffness: 200 } 
      });
    } else {
      controls.start({ 
        y: 0, 
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        transition: { type: 'spring', damping: 25, stiffness: 200 } 
      });
    }
  }, [isAppletsOpen, controls]);

  const handleDragEnd = (event: any, info: PanInfo) => {
    if (!isAppletsOpen && info.offset.y >= 100 && info.velocity.y >= 20) {
      navigate('/home?applets=open');
    } else if (isAppletsOpen && info.offset.y <= -50) {
      navigate('/home');
    } else {
      controls.start({ 
        y: isAppletsOpen ? '75vh' : 0, 
        borderTopLeftRadius: isAppletsOpen ? 40 : 0,
        borderTopRightRadius: isAppletsOpen ? 40 : 0,
        transition: { type: 'spring', damping: 25, stiffness: 200 } 
      });
    }
  };

  const handlePinTouchStart = () => {
    pinPressTimer.current = setTimeout(() => {
      setIsEditingPins(true);
    }, 500);
  };

  const handlePinTouchEnd = () => {
    if (pinPressTimer.current) clearTimeout(pinPressTimer.current);
  };

  const handleTrackingTouchStart = () => {
    trackingPressTimer.current = setTimeout(() => {
      setIsEditingTracking(true);
    }, 500);
  };

  const handleTrackingTouchEnd = () => {
    if (trackingPressTimer.current) clearTimeout(trackingPressTimer.current);
  };

  const recentApplets = [
    { id: 1, name: 'Agent Pilot', icon: Bot, color: 'bg-blue-500' },
    { id: 2, name: 'Web Search', icon: Globe, color: 'bg-blue-600' },
    { id: 3, name: 'Remote CLI', icon: Terminal, color: 'bg-indigo-500' },
    { id: 4, name: 'Code Review', icon: Code, color: 'bg-purple-500' },
  ];

  const installedApplets = [
    { id: 5, name: 'Data Sync', icon: Database, color: 'bg-teal-500' },
    { id: 6, name: 'Cloud Deploy', icon: Cloud, color: 'bg-sky-500' },
    { id: 7, name: 'AI Model', icon: Cpu, color: 'bg-rose-500' },
    { id: 8, name: 'Quick Task', icon: Zap, color: 'bg-amber-500' },
    { id: 9, name: 'Agent Pilot', icon: Bot, color: 'bg-blue-500' },
    { id: 10, name: 'Web Search', icon: Globe, color: 'bg-blue-600' },
    { id: 11, name: 'Remote CLI', icon: Terminal, color: 'bg-indigo-500' },
  ];

  const AppletIcon = ({ app, isMore = false, onClick }: { app?: any, isMore?: boolean, onClick?: () => void }) => (
    <div className="flex flex-col items-center gap-2 w-[22%] sm:w-[18%] mb-4 cursor-pointer" onClick={onClick}>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-sm ${isMore ? 'bg-gray-700' : app.color}`}>
        {isMore ? <MoreHorizontal size={24} /> : <app.icon size={24} />}
      </div>
      <span className="text-[11px] text-gray-300 font-medium text-center w-full truncate px-1">
        {isMore ? '更多' : app.name}
      </span>
    </div>
  );

  const pinnedItems = [
    { id: 1, name: 'Agent Pilot', type: 'Agent', icon: Bot, color: 'bg-blue-500' },
    { id: 2, name: 'Web Search', type: '小程序', icon: Globe, color: 'bg-indigo-500' },
    { id: 3, name: '张三', type: '人员', icon: User, color: 'bg-green-500' },
    { id: 4, name: 'Code Review', type: 'Agent', icon: Code, color: 'bg-purple-500' },
    { id: 5, name: 'Data Sync', type: '小程序', icon: Database, color: 'bg-teal-500' },
  ];

  const trackingItems = [
    { id: 1, title: '服务器监控', desc: 'CPU使用率 85%，内存 60%', height: 'h-32', color: 'bg-red-50 border-red-100' },
    { id: 2, title: '项目进度', desc: '前端重构已完成 80%', height: 'h-40', color: 'bg-blue-50 border-blue-100' },
    { id: 3, title: '待办事项', desc: '下午 3 点产品评审会议', height: 'h-28', color: 'bg-yellow-50 border-yellow-100' },
    { id: 4, title: 'API 状态', desc: '所有服务运行正常', height: 'h-36', color: 'bg-green-50 border-green-100' },
  ];

  return (
    <div className="relative flex flex-col h-full bg-gray-900 overflow-hidden">
      {/* Applets Background Layer */}
      <div className="absolute inset-0 z-0 pt-12 px-5 overflow-y-auto pb-32">
        <div className="flex flex-col items-center mb-6">
          <div className="w-10 h-1 bg-gray-700 rounded-full mb-4"></div>
          <p className="text-gray-400 text-xs font-medium tracking-widest">下拉返回</p>
        </div>

        <div className="mb-8">
          <h3 className="text-gray-400 text-sm font-bold mb-4 px-1">最近使用</h3>
          <div className="flex flex-wrap justify-start gap-x-[4%]">
            {recentApplets.map(app => <AppletIcon key={app.id} app={app} />)}
          </div>
        </div>

        <div>
          <h3 className="text-gray-400 text-sm font-bold mb-4 px-1">我的 Applet</h3>
          <div className="flex flex-wrap justify-start gap-x-[4%]">
            {installedApplets.map(app => <AppletIcon key={app.id} app={app} />)}
            <AppletIcon isMore onClick={() => navigate('/home?search=open')} />
          </div>
        </div>
      </div>

      {/* Main Content Layer */}
      <motion.div 
        className="absolute inset-0 z-10 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden"
        animate={controls}
        drag="y"
        dragConstraints={{ top: 0, bottom: window.innerHeight * 0.75 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
      >
        {/* Drag Handle Area */}
        <div className="w-full pt-3 pb-1 flex justify-center items-center cursor-grab active:cursor-grabbing">
          <div className="w-12 h-1.5 bg-gray-200 rounded-full"></div>
        </div>

        <div 
          className="flex-1 overflow-y-auto pointer-events-auto"
          style={{ paddingBottom: 'calc(1.5rem + var(--tab-height, 0px))' }}
        >
          {/* Unified Top Search & Action Bar */}
          <div className="px-5 pt-4 pb-6">
            <div 
              className="bg-gray-50 rounded-2xl p-2.5 flex items-center gap-3 shadow-sm border border-gray-100 cursor-text hover:border-purple-200 hover:shadow-md transition-all duration-200"
              onClick={() => navigate('/home?search=open')}
            >
              <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                <Search size={18} className="text-gray-500" />
              </div>
              <span className="text-gray-400 text-[15px] flex-1 truncate">搜索对话、工具、帮助...</span>
              
              <div className="flex items-center gap-2 pr-1">
                <div className="bg-white px-2 py-1 rounded-md text-xs text-gray-400 font-medium border border-gray-100 hidden sm:block shadow-sm">⌘ K</div>
                <div className="w-[1px] h-4 bg-gray-200"></div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate('/login');
                  }} 
                  className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-[#6b46c1] hover:bg-purple-50 rounded-xl transition-colors"
                >
                  <ScanLine size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="px-5">
            {/* Pinned Section */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="w-8 h-8 flex items-center justify-center bg-purple-50 rounded-full">
                  <Pin size={16} className="text-[#6b46c1]" />
                </div>
                <button 
                  onClick={() => setIsEditingPins(!isEditingPins)}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${isEditingPins ? 'bg-[#6b46c1] text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                >
                  {isEditingPins ? <X size={16} /> : <Settings2 size={16} />}
                </button>
              </div>
              
              <div 
                className="flex overflow-x-auto hide-scrollbar gap-4 pb-4 pt-2 px-1 -mx-1"
                onTouchStart={handlePinTouchStart}
                onTouchEnd={handlePinTouchEnd}
                onMouseDown={handlePinTouchStart}
                onMouseUp={handlePinTouchEnd}
                onMouseLeave={handlePinTouchEnd}
              >
                {pinnedItems.map(item => (
                  <div key={item.id} className={`relative cursor-pointer group flex-shrink-0 ${isEditingPins ? 'animate-[jiggle_0.3s_ease-in-out_infinite]' : ''}`}>
                    <div className={`w-[3.5rem] h-[3.5rem] rounded-[1.125rem] flex items-center justify-center text-white shadow-md transition-transform ${isEditingPins ? '' : 'hover:scale-105'} ${item.color}`}>
                      <item.icon size={26} strokeWidth={2.5} />
                    </div>
                    {/* Badge */}
                    {!isEditingPins && (
                      <div className={`absolute -bottom-2 -right-1 px-1.5 py-[2px] rounded-md text-[9px] font-bold border shadow-sm whitespace-nowrap z-10 scale-90 origin-bottom-right ${
                        item.type === 'Agent' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                        item.type === '小程序' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' :
                        'bg-green-50 text-green-600 border-green-200'
                      }`}>
                        {item.type}
                      </div>
                    )}
                    {/* Delete Button */}
                    {isEditingPins && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white shadow-md border-2 border-white z-20">
                        <X size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Tracking Section */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="w-8 h-8 flex items-center justify-center bg-blue-50 rounded-full">
                  <Activity size={16} className="text-blue-600" />
                </div>
                <button 
                  onClick={() => setIsEditingTracking(!isEditingTracking)}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${isEditingTracking ? 'bg-[#6b46c1] text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                >
                  {isEditingTracking ? <X size={16} /> : <Settings2 size={16} />}
                </button>
              </div>

              <div 
                className="columns-2 gap-4 space-y-4"
                onTouchStart={handleTrackingTouchStart}
                onTouchEnd={handleTrackingTouchEnd}
                onMouseDown={handleTrackingTouchStart}
                onMouseUp={handleTrackingTouchEnd}
                onMouseLeave={handleTrackingTouchEnd}
              >
                {trackingItems.map(item => (
                  <div 
                    key={item.id} 
                    className={`relative break-inside-avoid rounded-2xl p-4 border shadow-sm ${item.color} ${item.height} flex flex-col justify-between ${isEditingTracking ? 'animate-[jiggle_0.3s_ease-in-out_infinite_reverse]' : ''}`}
                  >
                    <h4 className="font-bold text-gray-800 text-[15px]">{item.title}</h4>
                    <p className="text-[13px] text-gray-600 leading-tight">{item.desc}</p>
                    
                    {isEditingTracking && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white shadow-md border-2 border-white z-20">
                        <X size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        @keyframes jiggle {
          0% { transform: rotate(-1deg); }
          50% { transform: rotate(1.5deg); }
          100% { transform: rotate(-1deg); }
        }
      `}</style>
    </div>
  );
};

export default Home;