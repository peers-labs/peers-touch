import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Users, 
  BarChart2, 
  Settings, 
  Search, 
  Plus, 
  Paperclip, 
  Smile, 
  Send,
  Check,
  CheckCheck,
  Info,
  X,
  UserPlus,
  LogOut,
  Edit2,
  Reply,
  Trash2,
  Phone,
  Video,
  AlertCircle,
  FileText,
  LayoutGrid,
  Brain,
  Clock,
  Bot,
  HelpCircle
} from 'lucide-react';
import { cn } from '../lib/utils';

// Mock Data
const currentUser = { id: 'u1', name: 'Alex', avatar: 'https://picsum.photos/seed/alex/100/100' };

const sessions = [
  { id: 's1', type: 'direct', name: 'Sarah Jenkins', avatar: 'https://picsum.photos/seed/sarah/100/100', lastMessage: 'See you tomorrow!', time: '10:42 AM', unread: 2, online: true },
  { id: 's2', type: 'group', name: 'Design Team', avatar: 'https://picsum.photos/seed/design/100/100', lastMessage: 'Alex: Here is the latest prototype.', time: 'Yesterday', unread: 0, online: false, members: 8 },
  { id: 's3', type: 'direct', name: 'Mike Ross', avatar: 'https://picsum.photos/seed/mike/100/100', lastMessage: 'Can you send the files?', time: 'Tuesday', unread: 0, online: false },
];

const messages = {
  's1': [
    { id: 'm1', senderId: 's1', text: 'Hey Alex, are we still on for the meeting?', time: '10:30 AM', status: 'read' },
    { id: 'm2', senderId: 'u1', text: 'Yes, absolutely. I have the presentation ready.', time: '10:35 AM', status: 'read' },
    { id: 'm3', senderId: 's1', text: 'Great! See you tomorrow!', time: '10:42 AM', status: 'delivered' },
  ],
  's2': [
    { id: 'm4', senderId: 'u2', senderName: 'Jessica', text: 'Has anyone seen the new brand guidelines?', time: 'Yesterday 2:00 PM', status: 'read' },
    { id: 'm5', senderId: 'u1', text: 'Here is the latest prototype.', time: 'Yesterday 3:15 PM', status: 'read', quote: { text: 'Has anyone seen the new brand guidelines?', sender: 'Jessica' } },
  ]
};

const mockContacts = [
  { id: 'c1', name: 'Sarah Jenkins', avatar: 'https://picsum.photos/seed/sarah/100/100' },
  { id: 'c2', name: 'Mike Ross', avatar: 'https://picsum.photos/seed/mike/100/100' },
  { id: 'c3', name: 'Jessica Pearson', avatar: 'https://picsum.photos/seed/jessica/100/100' },
  { id: 'c4', name: 'Harvey Specter', avatar: 'https://picsum.photos/seed/harvey/100/100' },
  { id: 'c5', name: 'Louis Litt', avatar: 'https://picsum.photos/seed/louis/100/100' },
  { id: 'c6', name: 'Donna Paulsen', avatar: 'https://picsum.photos/seed/donna/100/100' },
  { id: 'c7', name: 'Rachel Zane', avatar: 'https://picsum.photos/seed/rachel/100/100' },
];

export default function ChatApp() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const activeTab = searchParams.get('tab') || 'search';
  const activeSessionId = searchParams.get('session') || 's1';
  const showInfo = searchParams.get('info') === 'true';
  const showPlusMenu = searchParams.get('menu') === 'plus';
  const showCreateGroupModal = searchParams.get('modal') === 'create_group';
  const showFindPeopleModal = searchParams.get('modal') === 'find_people';

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const activeMessages = messages[activeSessionId as keyof typeof messages] || [];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (activeTab === 'messages') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSessionId, activeTab]);

  const handleTabChange = (tab: string) => navigate(`?tab=${tab}`);
  const handleSessionChange = (id: string) => navigate(`?tab=messages&session=${id}`);
  const toggleInfo = () => navigate(`?tab=messages&session=${activeSessionId}&info=${!showInfo}`);

  const togglePlusMenu = () => {
    const newParams = new URLSearchParams(searchParams);
    if (showPlusMenu) {
      newParams.delete('menu');
    } else {
      newParams.set('menu', 'plus');
    }
    navigate(`?${newParams.toString()}`);
  };

  const openCreateGroupModal = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('menu');
    newParams.set('modal', 'create_group');
    navigate(`?${newParams.toString()}`);
  };

  const closeCreateGroupModal = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('modal');
    setSelectedContacts([]);
    setSearchQuery('');
    navigate(`?${newParams.toString()}`);
  };

  const openFindPeopleModal = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('menu');
    newParams.set('modal', 'find_people');
    navigate(`?${newParams.toString()}`);
  };

  const closeFindPeopleModal = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('modal');
    setSearchQuery('');
    navigate(`?${newParams.toString()}`);
  };

  const toggleContact = (id: string) => {
    setSelectedContacts(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const filteredContacts = mockContacts.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="h-screen w-full flex flex-col bg-white font-sans text-slate-900 overflow-hidden">
      {/* Top Bar */}
      <header className="h-14 border-b border-slate-200 flex items-center justify-between px-6 shrink-0 bg-white z-30">
        <div className="font-bold text-sm tracking-wide">Peers-Touch</div>
        <div className="flex items-center gap-4">
          <button className="w-7 h-7 rounded-full bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 transition-colors">
            <AlertCircle size={16} strokeWidth={2.5} />
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <Users size={14} />
            <span>1</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation */}
        <nav className="w-16 bg-white border-r border-slate-200 flex flex-col items-center py-4 z-20 shrink-0">
          {/* User Avatar at top */}
          <div className="mb-6 relative group cursor-pointer">
            <img src={currentUser.avatar} alt="User" className="w-9 h-9 rounded-lg object-cover border border-slate-200 shadow-sm" />
          </div>
          
          <div className="flex flex-col gap-2 w-full px-2 flex-1">
            <NavItem icon={<Search size={20} />} active={activeTab === 'search'} onClick={() => handleTabChange('search')} tooltip="Search" />
            <NavItem icon={<MessageSquare size={20} />} active={activeTab === 'messages'} onClick={() => handleTabChange('messages')} tooltip="Messages" />
            <NavItem icon={<FileText size={20} />} active={activeTab === 'documents'} onClick={() => handleTabChange('documents')} tooltip="Documents" />
            <NavItem icon={<LayoutGrid size={20} />} active={activeTab === 'apps'} onClick={() => handleTabChange('apps')} tooltip="Apps" />
            <NavItem icon={<Brain size={20} />} active={activeTab === 'ai'} onClick={() => handleTabChange('ai')} tooltip="AI" />
            <NavItem icon={<Clock size={20} />} active={activeTab === 'history'} onClick={() => handleTabChange('history')} tooltip="History" />
            <NavItem icon={<Send size={20} />} active={activeTab === 'send'} onClick={() => handleTabChange('send')} tooltip="Send" />
          </div>

          <div className="mt-auto w-full px-2">
            <NavItem icon={<Settings size={20} />} active={activeTab === 'settings'} onClick={() => handleTabChange('settings')} tooltip="Settings" />
          </div>
        </nav>

        {/* Main Content Area based on Tab */}
        <main className="flex-1 flex overflow-hidden bg-white">
          {activeTab === 'search' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="w-full max-w-3xl flex flex-col items-center">
                <div className="w-16 h-16 bg-indigo-500 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg shadow-indigo-500/20">
                  <Bot size={32} strokeWidth={2} />
                </div>
                <h1 className="text-3xl font-bold mb-3 text-slate-900">Search Peers-Touch</h1>
                <p className="text-slate-500 mb-8 text-sm">Search conversations, tools, help, providers — or ask AI</p>
                
                <div className="w-full relative mb-8">
                  <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Search anything..." 
                    className="w-full h-14 pl-12 pr-16 rounded-xl border border-slate-200 bg-white shadow-sm text-base outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-xs font-medium text-slate-500 border border-slate-200">
                    <span>⌘</span>
                    <span>K</span>
                  </div>
                </div>

                <div className="flex items-center gap-6 border-b border-slate-200 w-full justify-center">
                  <SearchTab icon={<Search size={16} />} label="All" active />
                  <SearchTab icon={<MessageSquare size={16} />} label="Conversations" />
                  <SearchTab icon={<LayoutGrid size={16} />} label="Sessions" />
                  <SearchTab icon={<Settings size={16} />} label="Tools" />
                  <SearchTab icon={<HelpCircle size={16} />} label="Help" />
                  <SearchTab icon={<LayoutGrid size={16} />} label="Providers" />
                  <SearchTab icon={<FileText size={16} />} label="Documents" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'messages' && (
            <>
              {/* Session List */}
              <div className="w-80 bg-slate-50/50 border-r border-slate-200 flex flex-col z-10 shrink-0">
                <div className="h-16 px-4 border-b border-slate-200 bg-white flex items-center shrink-0">
                  <div className="flex items-center gap-2 relative w-full">
                    <div className="relative flex-1">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Search messages..." 
                        className="w-full bg-slate-100 text-sm rounded-lg pl-9 pr-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                      />
                    </div>
                    <div className="relative">
                      <button 
                        onClick={togglePlusMenu}
                        className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0",
                          showPlusMenu ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        <Plus size={20} />
                      </button>
                      
                      {/* Dropdown Menu */}
                      <AnimatePresence>
                        {showPlusMenu && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 py-2 z-50"
                          >
                            <button 
                              onClick={openFindPeopleModal}
                              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <UserPlus size={16} className="text-slate-400" />
                              Find People
                            </button>
                            <button 
                              onClick={openCreateGroupModal}
                              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <Users size={16} className="text-slate-400" />
                              Create Group
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                  {sessions.map(session => (
                    <div 
                      key={session.id}
                      onClick={() => handleSessionChange(session.id)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all",
                        activeSessionId === session.id ? "bg-white shadow-sm border border-slate-200/60" : "hover:bg-slate-100/80 border border-transparent"
                      )}
                    >
                      <div className="relative shrink-0">
                        <img src={session.avatar} alt={session.name} className="w-11 h-11 rounded-full object-cover" />
                        {session.online && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <h3 className="font-semibold text-sm truncate text-slate-900">{session.name}</h3>
                          <span className="text-xs text-slate-400 shrink-0">{session.time}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-sm text-slate-500 truncate pr-2">{session.lastMessage}</p>
                          {session.unread > 0 && (
                            <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                              {session.unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Main Chat Area */}
              {activeSession ? (
                <div className="flex-1 flex flex-col bg-white relative min-w-0">
                  {/* Chat Header */}
                  <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <img src={activeSession.avatar} alt={activeSession.name} className="w-10 h-10 rounded-full object-cover" />
                        {activeSession.online && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                        )}
                      </div>
                      <div>
                        <h2 className="font-semibold text-slate-900">{activeSession.name}</h2>
                        <p className="text-xs text-slate-500">
                          {activeSession.type === 'group' ? `${activeSession.members} members` : (activeSession.online ? 'Online' : 'Offline')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <Phone size={18} />
                      </button>
                      <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <Video size={18} />
                      </button>
                      <div className="w-px h-5 bg-slate-200 mx-2"></div>
                      <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <Search size={18} />
                      </button>
                      <button 
                        onClick={toggleInfo}
                        className={cn("p-2 rounded-lg transition-colors", showInfo ? "text-indigo-600 bg-indigo-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100")}
                      >
                        <Info size={18} />
                      </button>
                    </div>
                  </header>

                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
                    {activeMessages.map((msg, idx) => {
                      const isMe = msg.senderId === currentUser.id;
                      return (
                        <div key={msg.id} className={cn("flex gap-3 max-w-[75%] group", isMe ? "ml-auto flex-row-reverse" : "")}>
                          {!isMe && activeSession.type === 'group' && (
                            <img src={`https://picsum.photos/seed/${msg.senderId}/100/100`} alt="avatar" className="w-8 h-8 rounded-full mt-auto shrink-0" />
                          )}
                          
                          <div className={cn("flex flex-col relative", isMe ? "items-end" : "items-start")}>
                            {!isMe && activeSession.type === 'group' && (
                              <span className="text-xs text-slate-500 mb-1 ml-1">{msg.senderName}</span>
                            )}
                            
                            {msg.quote && (
                              <div className={cn("mb-1 p-2 rounded-lg text-sm border-l-2", isMe ? "bg-indigo-50 border-indigo-400 text-indigo-900" : "bg-slate-100 border-slate-300 text-slate-700")}>
                                <div className="font-medium text-xs mb-0.5">{msg.quote.sender}</div>
                                <div className="opacity-80 line-clamp-1">{msg.quote.text}</div>
                              </div>
                            )}

                            <div className="flex items-center gap-2">
                              {isMe && (
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mr-2">
                                  <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-md"><Reply size={14} /></button>
                                  <button className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 size={14} /></button>
                                </div>
                              )}
                              
                              <div className={cn(
                                "px-4 py-2.5 rounded-2xl text-sm shadow-sm",
                                isMe ? "bg-indigo-600 text-white rounded-br-sm" : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                              )}>
                                {msg.text}
                              </div>

                              {!isMe && (
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-2">
                                  <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-md"><Reply size={14} /></button>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1 mt-1 mx-1">
                              <span className="text-[11px] text-slate-400">{msg.time}</span>
                              {isMe && (
                                msg.status === 'read' ? <CheckCheck size={14} className="text-indigo-500" /> : <Check size={14} className="text-slate-400" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input Area */}
                  <div className="p-4 bg-white border-t border-slate-200 flex items-end gap-2 shrink-0">
                    <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors shrink-0">
                      <Paperclip size={20} />
                    </button>
                    <div className="flex-1 bg-slate-100 rounded-2xl flex items-end px-2 py-1">
                      <textarea 
                        placeholder="Type a message..." 
                        className="flex-1 max-h-32 min-h-[36px] bg-transparent resize-none outline-none py-2 px-2 text-sm"
                        rows={1}
                      />
                      <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors shrink-0 mb-0.5">
                        <Smile size={20} />
                      </button>
                    </div>
                    <button className="p-2.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-full transition-colors shrink-0 shadow-md shadow-indigo-500/20">
                      <Send size={18} className="ml-0.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-slate-50">
                  <div className="text-center text-slate-400">
                    <MessageSquare size={48} className="mx-auto mb-4 opacity-20" />
                    <p>Select a chat to start messaging</p>
                  </div>
                </div>
              )}

              {/* Right Panel (Info) */}
              <AnimatePresence>
                {showInfo && activeSession && (
                  <motion.div 
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 320, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    className="bg-white border-l border-slate-200 flex flex-col overflow-hidden shrink-0"
                  >
                    <div className="h-16 border-b border-slate-200 flex items-center justify-between px-5 shrink-0">
                      <h3 className="font-semibold">Details</h3>
                      <button onClick={toggleInfo} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md">
                        <X size={18} />
                      </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6">
                      <div className="flex flex-col items-center text-center mb-8 relative group">
                        <img src={activeSession.avatar} alt={activeSession.name} className="w-24 h-24 rounded-full object-cover mb-4 shadow-sm border border-slate-100" />
                        {activeSession.type === 'group' && (
                          <button className="absolute top-0 right-4 p-2 bg-white rounded-full shadow-md text-slate-600 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Edit2 size={16} />
                          </button>
                        )}
                        <h2 className="text-xl font-bold mb-1">{activeSession.name}</h2>
                        <p className="text-sm text-slate-500">
                          {activeSession.type === 'group' ? `${activeSession.members} members` : 'Product Designer'}
                        </p>
                      </div>

                      {activeSession.type === 'group' && (
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-slate-900">Members</h4>
                            <button className="text-xs text-indigo-600 font-medium hover:underline">See all</button>
                          </div>
                          <div className="space-y-3">
                            {[1,2,3].map(i => (
                              <div key={i} className="flex items-center gap-3 group/member">
                                <img src={`https://picsum.photos/seed/m${i}/100/100`} className="w-8 h-8 rounded-full" />
                                <span className="text-sm font-medium flex-1">Member {i}</span>
                                <button className="text-slate-400 hover:text-red-600 opacity-0 group-hover/member:opacity-100 transition-opacity">
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button className="w-full mt-4 py-2 flex items-center justify-center gap-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
                            <UserPlus size={16} />
                            Add Member
                          </button>
                        </div>
                      )}

                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Actions</h4>
                        <button className="w-full flex items-center gap-3 p-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-xl transition-colors">
                          <Search size={18} className="text-slate-400" />
                          Search in Conversation
                        </button>
                        <button className="w-full flex items-center gap-3 p-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-xl transition-colors">
                          <BarChart2 size={18} className="text-slate-400" />
                          Chat Statistics
                        </button>
                        <button className="w-full flex items-center gap-3 p-3 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors mt-4">
                          <LogOut size={18} />
                          {activeSession.type === 'group' ? 'Leave Group' : 'Block User'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* Other Tabs Placeholders */}
          {['documents', 'apps', 'ai', 'history', 'send', 'settings'].includes(activeTab) && (
            <div className="flex-1 flex flex-col bg-white">
              <header className="h-16 border-b border-slate-200 flex items-center px-8">
                <h1 className="text-xl font-bold capitalize">{activeTab}</h1>
              </header>
              <div className="flex-1 p-8 flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <div className="mx-auto mb-4 opacity-20 flex justify-center">
                    {activeTab === 'documents' && <FileText size={48} />}
                    {activeTab === 'apps' && <LayoutGrid size={48} />}
                    {activeTab === 'ai' && <Brain size={48} />}
                    {activeTab === 'history' && <Clock size={48} />}
                    {activeTab === 'send' && <Send size={48} />}
                    {activeTab === 'settings' && <Settings size={48} />}
                  </div>
                  <p className="capitalize">{activeTab} view placeholder</p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCreateGroupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="bg-white w-full max-w-[640px] h-[500px] rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col"
            >
              {/* Header / Top Bar */}
              <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
                <h3 className="text-lg font-semibold text-slate-800">Start Group Chat</h3>
                <button onClick={closeCreateGroupModal} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-colors">
                  <X size={18} />
                </button>
              </div>
              
              {/* Search Bar */}
              <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
                <div className="relative w-full">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Search contacts..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-sm rounded-lg pl-9 pr-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-sm" 
                  />
                </div>
              </div>

              {/* Content: Contact List */}
              <div className="flex-1 overflow-y-auto p-2">
                {filteredContacts.length > 0 ? (
                  filteredContacts.map(contact => {
                    const isSelected = selectedContacts.includes(contact.id);
                    return (
                      <div 
                        key={contact.id}
                        onClick={() => toggleContact(contact.id)}
                        className="flex items-center gap-4 px-4 py-2.5 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors"
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-full border flex items-center justify-center transition-colors",
                          isSelected ? "bg-indigo-500 border-indigo-500" : "border-slate-300"
                        )}>
                          {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                        </div>
                        <img src={contact.avatar} alt={contact.name} className="w-10 h-10 rounded-full object-cover" />
                        <span className="text-sm font-medium text-slate-700">{contact.name}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                    No contacts found
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-white">
                <button 
                  onClick={closeCreateGroupModal} 
                  className="px-6 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={closeCreateGroupModal} 
                  disabled={selectedContacts.length === 0}
                  className={cn(
                    "px-6 py-2 text-sm font-medium rounded-lg transition-colors",
                    selectedContacts.length > 0 
                      ? "text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm" 
                      : "text-slate-400 bg-slate-100 cursor-not-allowed"
                  )}
                >
                  Finish
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Find People Modal */}
      <AnimatePresence>
        {showFindPeopleModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="bg-white w-full max-w-[540px] h-[500px] rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col"
            >
              <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
                <h3 className="text-lg font-semibold text-slate-800">Find People</h3>
                <button onClick={closeFindPeopleModal} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
                <div className="relative w-full">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Search by name or email..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-sm rounded-lg pl-9 pr-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-sm" 
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {filteredContacts.length > 0 ? (
                  filteredContacts.map(contact => (
                    <div key={contact.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 rounded-xl transition-colors">
                      <div className="flex items-center gap-3">
                        <img src={contact.avatar} alt={contact.name} className="w-10 h-10 rounded-full object-cover" />
                        <div>
                          <div className="text-sm font-medium text-slate-700">{contact.name}</div>
                          <div className="text-xs text-slate-500">Network User</div>
                        </div>
                      </div>
                      <button className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-1">
                        <UserPlus size={14} />
                        Add
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                    No users found
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, active, onClick, tooltip }: { icon: React.ReactNode, active: boolean, onClick: () => void, tooltip: string }) {
  return (
    <div className="relative group w-full flex justify-center">
      <button 
        onClick={onClick}
        className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center transition-all relative",
          active ? "bg-indigo-50 text-indigo-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
        )}
      >
        {icon}
      </button>
      <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        {tooltip}
      </div>
    </div>
  );
}

function SearchTab({ icon, label, active }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button className={cn(
      "flex items-center gap-2 py-3 text-sm font-medium transition-colors border-b-2",
      active ? "text-slate-900 border-slate-900" : "text-slate-500 border-transparent hover:text-slate-700"
    )}>
      {icon}
      {label}
    </button>
  );
}