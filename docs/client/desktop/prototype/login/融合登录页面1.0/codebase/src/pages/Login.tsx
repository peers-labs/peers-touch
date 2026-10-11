import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Github, 
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { cn } from '../lib/utils';

export default function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const state = searchParams.get('state') || 'logged_out';
  const tab = searchParams.get('tab') || 'email';

  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [state, tab]);

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    navigate('?state=logged_in');
  };

  const handleSwitchAccount = () => navigate('?state=logged_out&tab=quick');

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans text-slate-900">
      <AnimatePresence mode="wait">
        {state === 'logged_out' ? (
          <motion.div 
            key="logged_out"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="bg-white w-full max-w-[400px] rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 p-8 md:p-10 flex flex-col items-center relative overflow-hidden"
          >
            {/* Main Icon */}
            <div className="bg-slate-900 text-white p-3 rounded-2xl mb-6 shadow-lg shadow-slate-900/20">
              <Lock size={24} strokeWidth={2.5} />
            </div>

            {/* Typography */}
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold tracking-tight mb-2">Welcome</h1>
              <p className="text-slate-500 text-sm">
                Sign in to your account to continue
              </p>
            </div>

            {/* Tabs */}
            <div className="w-full bg-slate-100/80 p-1 rounded-xl flex mb-8 border border-slate-200/50">
              <button
                onClick={() => navigate('?state=logged_out&tab=quick')}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-lg transition-all",
                  tab === 'quick' 
                    ? "bg-white text-slate-900 shadow-sm border border-slate-200/50" 
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                Quick Login
              </button>
              <button
                onClick={() => navigate('?state=logged_out&tab=email')}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-lg transition-all",
                  tab === 'email' 
                    ? "bg-white text-slate-900 shadow-sm border border-slate-200/50" 
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                Email Login
              </button>
            </div>

            {/* Form Area */}
            <div className="w-full">
              {tab === 'email' ? (
                <motion.form 
                  key="email-form"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-5"
                  onSubmit={handleLogin}
                >
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Email address</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Mail size={18} />
                      </div>
                      <input 
                        type="email" 
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium text-slate-700">Password</label>
                      <a href="#" className="text-xs text-slate-500 hover:text-slate-900 transition-colors">Forgot password?</a>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Lock size={18} />
                      </div>
                      <input 
                        type={showPassword ? "text" : "password"} 
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                        required
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-3 mt-2 rounded-xl font-medium text-white bg-slate-900 hover:bg-slate-800 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                  >
                    Sign In
                    <ArrowRight size={16} />
                  </button>
                </motion.form>
              ) : (
                <motion.div 
                  key="quick-form"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-3"
                >
                  <button 
                    onClick={() => handleLogin()}
                    className="w-full py-3 px-4 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-3 shadow-sm"
                  >
                    <Github size={18} />
                    Continue with GitHub
                  </button>
                  <button 
                    onClick={() => handleLogin()}
                    className="w-full py-3 px-4 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-3 shadow-sm"
                  >
                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </button>
                </motion.div>
              )}
            </div>

            <div className="mt-8 text-center">
              <p className="text-sm text-slate-500">
                Don't have an account? <a href="#" className="text-slate-900 font-medium hover:underline">Sign up</a>
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="logged_in"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="bg-white w-full max-w-[400px] rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 p-10 flex flex-col items-center relative overflow-hidden"
          >
            {/* User Profile Section */}
            <div className="flex flex-col items-center mb-8 w-full mt-4">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-blue-500 rounded-full blur-2xl opacity-20"></div>
                <img 
                  src="https://picsum.photos/seed/dog/120/120" 
                  alt="Avatar" 
                  className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md relative z-10"
                />
                <div className="absolute bottom-1 right-1 w-5 h-5 bg-green-500 border-2 border-white rounded-full z-20"></div>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-1">Welcome back,</h1>
              <h2 className="text-xl font-bold text-slate-800 mb-2">developer</h2>
              <p className="text-sm text-slate-500">developer@example.com</p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 w-full">
              <button 
                onClick={handleSwitchAccount}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={16} />
                Switch Account
              </button>
              <button 
                onClick={() => {}}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
              >
                Continue
                <ArrowRight size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}