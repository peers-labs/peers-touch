import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, MessageSquare, Users, UserPlus } from 'lucide-react';

const IMChat = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'messages';

  const chats = [
    { id: 1, name: '开发团队群', msg: 'API接口已经更新，请查收', time: '10:42', unread: 3, type: 'group' },
    { id: 2, name: '张三', msg: '好的，我马上处理', time: '昨天', unread: 0, type: 'single' },
    { id: 3, name: '系统通知', msg: '您的定时任务已执行完毕', time: '星期二', unread: 1, type: 'system' },
  ];

  const contacts = [
    { id: 2, name: '张三', status: '在线', avatar: 'bg-green-500' },
    { id: 4, name: '李四', status: '离线', avatar: 'bg-gray-400' },
    { id: 5, name: '王五', status: '忙碌', avatar: 'bg-red-500' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="px-5 pt-14 pb-4 flex items-center justify-between">
        <div className="flex bg-gray-200/50 p-1 rounded-2xl">
          <button 
            onClick={() => navigate('/im?tab=messages')}
            className={`w-12 h-10 rounded-xl flex items-center justify-center transition-all ${tab === 'messages' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <MessageSquare size={20} strokeWidth={tab === 'messages' ? 2.5 : 2} />
          </button>
          <button 
            onClick={() => navigate('/im?tab=contacts')}
            className={`w-12 h-10 rounded-xl flex items-center justify-center transition-all ${tab === 'contacts' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Users size={20} strokeWidth={tab === 'contacts' ? 2.5 : 2} />
          </button>
        </div>
        <button 
          onClick={() => navigate('/im/add-friend')}
          className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-gray-700 shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors"
        >
          <UserPlus size={20} />
        </button>
      </div>

      <div className="px-5 pb-4">
        <div className="bg-white rounded-2xl p-3.5 flex items-center gap-3 shadow-sm border border-gray-100">
          <Search size={20} className="text-gray-400" />
          <input 
            type="text" 
            placeholder={tab === 'messages' ? "搜索消息..." : "搜索联系人..."}
            className="bg-transparent border-none outline-none text-[15px] w-full text-gray-900 placeholder-gray-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          {tab === 'messages' ? (
            chats.map((chat, index) => (
              <div 
                key={chat.id} 
                className={`flex items-center gap-4 px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer ${
                  index !== chats.length - 1 ? 'border-b border-gray-50' : ''
                }`}
                onClick={() => navigate(`/im/chat?id=${chat.id}`)}
              >
                <div className="relative">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold shadow-sm ${
                    chat.type === 'group' ? 'bg-blue-500' : chat.type === 'system' ? 'bg-orange-500' : 'bg-gray-300'
                  }`}>
                    {chat.type === 'group' ? <Users size={28} /> : chat.name[0]}
                  </div>
                  {chat.unread > 0 && (
                    <div className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[22px] text-center border-2 border-white shadow-sm">
                      {chat.unread}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="font-bold text-[16px] text-gray-900 truncate">{chat.name}</h3>
                    <span className="text-xs font-medium text-gray-400 flex-shrink-0 ml-2">{chat.time}</span>
                  </div>
                  <p className="text-[14px] text-gray-500 truncate">{chat.msg}</p>
                </div>
              </div>
            ))
          ) : (
            contacts.map((contact, index) => (
              <div 
                key={contact.id} 
                className={`flex items-center gap-4 px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer ${
                  index !== contacts.length - 1 ? 'border-b border-gray-50' : ''
                }`}
                onClick={() => navigate(`/im/chat?id=${contact.id}`)}
              >
                <div className="relative">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white text-lg font-bold shadow-sm ${contact.avatar}`}>
                    {contact.name[0]}
                  </div>
                  <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${
                    contact.status === '在线' ? 'bg-green-500' : contact.status === '忙碌' ? 'bg-red-500' : 'bg-gray-400'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[16px] text-gray-900 truncate">{contact.name}</h3>
                  <p className="text-[13px] text-gray-500 truncate">{contact.status}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default IMChat;