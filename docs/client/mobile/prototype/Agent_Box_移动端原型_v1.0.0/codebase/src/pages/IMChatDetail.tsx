import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Phone, Video, MoreHorizontal, Send, Plus, Smile } from 'lucide-react';

const IMChatDetail = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '1';
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50 relative">
      {/* Floating Header */}
      <div className="absolute top-0 left-0 right-0 pt-12 pb-4 px-4 flex items-center justify-between z-10 bg-gradient-to-b from-gray-50 via-gray-50/90 to-transparent">
        <button onClick={() => navigate('/im')} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-gray-700 shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
          <ChevronLeft size={24} className="mr-0.5" />
        </button>
        <span className="font-bold text-[17px] text-gray-900 tracking-tight">开发团队群</span>
        <button className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-gray-700 shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
          <MoreHorizontal size={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 pt-28 pb-6 space-y-5">
        <div className="flex justify-center">
          <span className="text-[11px] font-medium text-gray-400 bg-gray-200/50 px-3 py-1 rounded-full">昨天 10:42</span>
        </div>
        
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-500 rounded-2xl flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 shadow-sm">
            张三
          </div>
          <div className="bg-white border border-gray-100 text-gray-800 px-5 py-3 rounded-3xl rounded-tl-sm max-w-[75%] text-[15px] shadow-sm leading-relaxed">
            API接口已经更新，请查收。文档地址：http://api.docs...
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="bg-[#6b46c1] text-white px-5 py-3 rounded-3xl rounded-tr-sm max-w-[75%] text-[15px] shadow-sm leading-relaxed">
            收到，我马上测试一下。
          </div>
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white p-4 border-t border-gray-100 flex items-end gap-3 pb-6">
        <button className="w-11 h-11 bg-gray-50 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0">
          <Plus size={24} />
        </button>
        <div className="flex-1 bg-gray-50 border border-gray-100 rounded-3xl flex items-end p-1.5 shadow-sm">
          <textarea 
            className="flex-1 bg-transparent border-none outline-none resize-none max-h-32 min-h-[40px] py-2.5 px-3 text-[15px] text-gray-900 placeholder-gray-400"
            placeholder="输入消息..."
            rows={1}
          />
          <button className="p-2.5 text-gray-400 hover:text-gray-600 transition-colors">
            <Smile size={22} />
          </button>
        </div>
        <button className="w-11 h-11 bg-[#6b46c1] rounded-full flex items-center justify-center text-white flex-shrink-0 shadow-md shadow-purple-200 hover:bg-[#5a3aa3] transition-colors">
          <Send size={20} className="ml-0.5" />
        </button>
      </div>
    </div>
  );
};

export default IMChatDetail;