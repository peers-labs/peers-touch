import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Search, ScanLine, QrCode, UserPlus } from 'lucide-react';

const IMAddFriend = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const [query, setQuery] = useState(q);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/im/add-friend?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 relative">
      <div className="absolute top-12 left-5 z-10">
        <button onClick={() => navigate('/im?tab=contacts')} className="w-11 h-11 bg-white rounded-full flex items-center justify-center text-gray-700 shadow-md border border-gray-100 hover:bg-gray-50 transition-colors">
          <ChevronLeft size={24} className="mr-0.5" />
        </button>
      </div>

      <div className="pt-28 px-6 pb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 tracking-tight">添加好友</h1>

        <form onSubmit={handleSearch} className="mb-8">
          <div className="bg-white rounded-2xl p-3.5 flex items-center gap-3 shadow-sm border border-gray-100 focus-within:border-purple-300 focus-within:shadow-md transition-all">
            <Search size={20} className="text-gray-400" />
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入用户 ID 或手机号..." 
              className="bg-transparent border-none outline-none text-[15px] w-full text-gray-900 placeholder-gray-400"
            />
          </div>
        </form>

        {!q ? (
          <div className="space-y-4">
            <button className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
              <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-[#6b46c1]">
                <ScanLine size={24} />
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-bold text-[16px] text-gray-900">扫一扫</h3>
                <p className="text-[13px] text-gray-500">扫描二维码名片</p>
              </div>
            </button>

            <button className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                <QrCode size={24} />
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-bold text-[16px] text-gray-900">我的二维码</h3>
                <p className="text-[13px] text-gray-500">分享名片给朋友</p>
              </div>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-50">
              <h3 className="text-[13px] font-bold text-gray-400">搜索结果</h3>
            </div>
            <div className="flex items-center gap-4 px-4 py-5">
              <div className="w-14 h-14 bg-indigo-500 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-sm">
                {q[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-[16px] text-gray-900 truncate">{q}</h3>
                <p className="text-[13px] text-gray-500 truncate">ID: user_{Math.floor(Math.random() * 10000)}</p>
              </div>
              <button className="w-10 h-10 bg-[#6b46c1] rounded-full flex items-center justify-center text-white shadow-md shadow-purple-200 hover:bg-[#5a3aa3] transition-colors">
                <UserPlus size={20} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IMAddFriend;