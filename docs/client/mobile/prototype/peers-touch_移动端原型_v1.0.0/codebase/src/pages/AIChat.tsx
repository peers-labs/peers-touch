import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Bot, Sparkles, PlusCircle, Search, X, Maximize2, Camera, Image as ImageIcon, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const AIChat = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const step = searchParams.get('step') || '0';
  const selectorOpen = searchParams.get('selector') === 'open';
  const menuOpen = searchParams.get('menu') === 'open';
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [step]);

  const agents = [
    { id: 'builder', name: 'Agent Builder', desc: '告诉我你的使用场景...', icon: '🏗️', color: 'bg-orange-100' },
    { id: 'box', name: 'Peers-Touch', desc: '你的默认个人 AI 助手...', icon: <Bot size={20} className="text-white" />, color: 'bg-[#6b46c1]' },
    { id: 'cli', name: 'CLI Helper', desc: '远程 CLI 的 AI 助手...', icon: '💻', color: 'bg-gray-800' },
    { id: 'coder', name: 'Coder', desc: '专注于编写、审查代码...', icon: '👨‍💻', color: 'bg-blue-100' },
    { id: 'researcher', name: 'Researcher', desc: '深度研究助手...', icon: '🔬', color: 'bg-teal-100' },
    { id: 'writer', name: 'Writer', desc: '创意和专业写作...', icon: '✍️', color: 'bg-yellow-100' },
  ];

  const menuItems = [
    { icon: Maximize2, label: '放大编辑' },
    { icon: Camera, label: '打开相机' },
    { icon: ImageIcon, label: '选择照片' },
    { icon: FileText, label: '选择文件' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 relative">
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-2 space-y-5">
        {/* User Message */}
        <div className="flex flex-col items-end gap-1">
          <div className="bg-[#6b46c1] text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] text-[15px] shadow-sm leading-relaxed">
            帮我写一个快速排序算法，用Python实现。
          </div>
        </div>

        {/* AI Message with Thought Process */}
        {(step === '1' || step === '2') && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-[#6b46c1] shadow-sm rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              {/* Thought Process Block */}
              <div className="bg-white border border-gray-100 rounded-2xl p-3.5 shadow-sm">
                <div className="flex items-center gap-2 text-[13px] font-bold text-gray-500 mb-2">
                  <Sparkles size={16} className="text-purple-500" />
                  <span>思考过程</span>
                  <ChevronDown size={16} className="ml-auto text-gray-400" />
                </div>
                <div className="text-[13px] text-gray-500 space-y-1 pl-2.5 border-l-2 border-purple-100 leading-relaxed">
                  <p>1. 用户需要一个快速排序算法的Python实现。</p>
                  <p>2. 快速排序的核心思想是分治法：选择基准值，分区，递归。</p>
                  <p>3. 提供一个简洁易懂的实现版本，并附带注释和测试代码。</p>
                </div>
              </div>

              {/* Final Answer */}
              {step === '2' && (
                <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm p-4 text-[15px] text-gray-800 shadow-sm leading-relaxed">
                  <p className="mb-3">当然，这是一个简洁的Python快速排序实现：</p>
                  <div className="bg-gray-900 rounded-xl p-3 overflow-x-auto shadow-inner">
                    <pre className="text-[13px] text-gray-100 font-mono leading-relaxed">
{`def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

# 测试
print(quick_sort([3,6,8,10,1,2,1]))`}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div 
        className="px-3 pt-1 bg-transparent relative"
        style={{ paddingBottom: 'calc(0.5rem + var(--tab-height, 0px))' }}
      >
        {/* Floating Menu */}
        <AnimatePresence>
          {menuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40"
                onClick={() => navigate(`/ai?step=${step}`)}
              />
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                className="absolute right-4 bottom-[calc(3.5rem+var(--tab-height,0px))] flex flex-col gap-2.5 z-50"
              >
                {menuItems.map((item, idx) => (
                  <button 
                    key={idx}
                    onClick={() => navigate(`/ai?step=${step}`)}
                    className="w-10 h-10 bg-white rounded-full shadow-lg border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    <item.icon size={18} className="text-gray-600" />
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <div className="bg-white rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.06)] flex items-center px-1.5 py-1.5 gap-1.5 border border-gray-100">
          {/* Agent Selector on the left */}
          <button 
            onClick={() => navigate(`/ai?step=${step}&selector=open`)}
            className="flex items-center gap-1 hover:bg-gray-50 py-1.5 px-2 rounded-full transition-colors bg-gray-50 border border-gray-100 flex-shrink-0"
          >
            <div className="w-6 h-6 bg-[#6b46c1] rounded-full flex items-center justify-center">
              <Bot size={14} className="text-white" />
            </div>
            <ChevronDown size={14} className="text-gray-500" />
          </button>
          
          <div className="flex-1 flex items-center px-1">
            <input 
              type="text"
              className="w-full bg-transparent border-none outline-none text-[14px] text-gray-900 placeholder-gray-400"
              placeholder="发消息或按住说话..."
            />
          </div>

          <div className="flex items-center flex-shrink-0 pr-0.5">
            <button 
              onClick={() => navigate(`/ai?step=${step}&menu=${menuOpen ? 'closed' : 'open'}`)}
              className={`p-1.5 rounded-full transition-colors ${menuOpen ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <PlusCircle size={22} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      {/* Agent Selector Bottom Sheet */}
      {selectorOpen && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end">
          <div 
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => navigate(`/ai?step=${step}`)}
          />
          <div className="bg-white rounded-t-3xl w-full max-h-[85vh] flex flex-col relative z-10 shadow-2xl animate-in slide-in-from-bottom-full duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">切换 Agent</h2>
              <div className="flex items-center gap-3">
                <button className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center text-white">
                  <PlusCircle size={18} />
                </button>
                <button 
                  onClick={() => navigate(`/ai?step=${step}`)}
                  className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            
            <div className="p-4 border-b border-gray-100">
              <div className="bg-gray-50 rounded-xl p-2.5 flex items-center gap-2 border border-gray-200">
                <Search size={18} className="text-gray-400" />
                <input 
                  type="text" 
                  placeholder="搜索 Agent..." 
                  className="bg-transparent border-none outline-none text-[15px] w-full text-gray-900 placeholder-gray-400"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {agents.map((agent) => (
                <button 
                  key={agent.id}
                  onClick={() => navigate(`/ai?step=${step}`)}
                  className={`w-full flex items-center gap-3.5 p-3 rounded-2xl transition-colors text-left ${
                    agent.id === 'box' ? 'bg-gray-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-sm ${agent.color}`}>
                    {agent.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-[15px] text-gray-900 mb-0.5">{agent.name}</h3>
                    <p className="text-[13px] text-gray-400 truncate">{agent.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default AIChat;