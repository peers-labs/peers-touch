import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { QrCode, MonitorSmartphone, ChevronLeft } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status') || 'scanning'; // scanning, success

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Floating Back Button */}
      <div className="absolute top-12 left-5 z-10">
        <button onClick={() => navigate('/home')} className="w-11 h-11 bg-white rounded-full flex items-center justify-center text-gray-700 shadow-md border border-gray-100 hover:bg-gray-50 transition-colors">
          <ChevronLeft size={24} className="mr-0.5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20 pt-24">
        <div className="w-20 h-20 bg-[#6b46c1] rounded-3xl flex items-center justify-center mb-8 shadow-xl shadow-purple-200">
          <MonitorSmartphone size={40} className="text-white" />
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-3 tracking-tight">扫码登录</h1>
        <p className="text-[15px] text-gray-500 text-center mb-12 leading-relaxed">
          请使用桌面端 Peers-Touch 扫描下方二维码<br/>以同步您的账号和配置信息
        </p>

        <div className="relative w-72 h-72 bg-white border-2 border-gray-50 rounded-[2rem] shadow-lg shadow-gray-100/50 flex items-center justify-center p-5">
          {/* Mock QR Code */}
          <div className="w-full h-full bg-gray-50 rounded-2xl flex items-center justify-center border border-gray-100 relative overflow-hidden">
            <QrCode size={180} className="text-gray-800" strokeWidth={1} />
            {status === 'scanning' && (
              <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-transparent to-[#6b46c1]/20 animate-[scan_2s_ease-in-out_infinite_alternate] border-b-2 border-[#6b46c1]/50" />
            )}
            {status === 'success' && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center">
                <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-200">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            )}
          </div>
          
          {/* Corner markers */}
          <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-[#6b46c1] rounded-tl-2xl" />
          <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-[#6b46c1] rounded-tr-2xl" />
          <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-[#6b46c1] rounded-bl-2xl" />
          <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-[#6b46c1] rounded-br-2xl" />
        </div>

        {status === 'success' ? (
          <p className="mt-10 text-green-600 font-bold text-[16px]">扫描成功，正在登录...</p>
        ) : (
          <button 
            onClick={() => navigate('/login?status=success')}
            className="mt-10 text-[#6b46c1] text-[15px] font-bold px-6 py-3 rounded-full bg-purple-50 hover:bg-purple-100 transition-colors"
          >
            模拟扫描成功
          </button>
        )}
      </div>
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </div>
  );
};

export default Login;