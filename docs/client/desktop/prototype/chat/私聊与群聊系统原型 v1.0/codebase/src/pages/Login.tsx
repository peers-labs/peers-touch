import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  LogIn, 
  Github, 
  Clock, 
  ShieldCheck, 
  RefreshCw, 
  LogOut,
  ChevronRight
} from 'lucide-react';
import { cn } from '../lib/utils';

export default function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const view = searchParams.get('view') || 'default';

  // Handle prototype routing scroll if needed (not strictly needed here as it's a single screen, but good practice)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const handleSwitchAccount = () => navigate('?view=switch_account');
  const handleSignOut = () => navigate('?view=signed_out');
  const handleReset = () => navigate('?view=default');

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans text-slate-900">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="bg-white w-full max-w-[640px] rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 p-10 md:p-12 flex flex-col items-center relative overflow-hidden"
      >
        {/* Progress Dots */}
        <div className="flex gap-2 mb-10">
          <div className="w-8 h-2 rounded-full bg-slate-800"></div>
          <div className="w-2 h-2 rounded-full bg-slate-200"></div>
          <div className="w-2 h-2 rounded-full bg-slate-200"></div>
          <div className="w-2 h-2 rounded-full bg-slate-200"></div>
        </div>

        {/* Main Icon */}
        <div className="bg-blue-500 text-white p-4 rounded-2xl mb-6 shadow-lg shadow-blue-500/20">
          <LogIn size={32} strokeWidth={2.5} />
        </div>

        {/* Typography */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-3">Sign in to start</h1>
          <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
            Sign in to your account. You can continue now and complete your account profile later.
          </p>
        </div>

        {/* Dynamic Content Area based on view state */}
        <div className="w-full w-full transition-all duration-300">
          {view === 'default' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/60 relative"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-slate-700">Current Account</h3>
                <button 
                  onClick={handleSwitchAccount}
                  className="text-sm font-medium text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                >
                  Switch Account
                </button>
              </div>

              {/* Account Card */}
              <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <img 
                      src="https://picsum.photos/seed/dog/120/120" 
                      alt="Avatar" 
                      className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm"
                    />
                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                      <Github size={16} className="text-slate-800" />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-base font-semibold text-slate-900 truncate">printfcoder</h2>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-100">
                        Active
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 truncate mb-3">
                      GitHub · printfcoder@gmail.com
                    </p>

                    {/* Timestamps */}
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} />
                        <span>Authorized Mar 27, 2026</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck size={12} />
                        <span>Refresh Mar 27, 2026</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-3">
                  <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors">
                    <RefreshCw size={16} />
                  </button>
                  <button 
                    onClick={handleSignOut}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-colors"
                  >
                    <LogOut size={16} />
                    Sign Out
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'switch_account' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-50/80 rounded-2xl p-8 border border-slate-200/60 text-center"
            >
              <div className="w-16 h-16 bg-slate-200 rounded-full mx-auto mb-4 flex items-center justify-center text-slate-400">
                <Github size={32} />
              </div>
              <h3 className="text-lg font-semibold mb-2">Select an account</h3>
              <p className="text-sm text-slate-500 mb-6">Choose another account to continue.</p>
              <button 
                onClick={handleReset}
                className="text-blue-600 font-medium hover:underline"
              >
                Back to current account
              </button>
            </motion.div>
          )}

          {view === 'signed_out' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-50/80 rounded-2xl p-8 border border-slate-200/60 text-center"
            >
              <div className="w-16 h-16 bg-red-100 rounded-full mx-auto mb-4 flex items-center justify-center text-red-500">
                <LogOut size={32} />
              </div>
              <h3 className="text-lg font-semibold mb-2">Signed Out</h3>
              <p className="text-sm text-slate-500 mb-6">You have been successfully signed out.</p>
              <button 
                onClick={handleReset}
                className="text-blue-600 font-medium hover:underline"
              >
                Sign in again
              </button>
            </motion.div>
          )}
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-center gap-4 mt-10 w-full">
          <button className="px-8 py-3 rounded-full font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-all min-w-[120px]">
            Skip
          </button>
          <button className="px-8 py-3 rounded-full font-medium text-white bg-slate-900 hover:bg-slate-800 shadow-md hover:shadow-lg transition-all min-w-[120px] flex items-center justify-center gap-2">
            Continue
            <ChevronRight size={18} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}