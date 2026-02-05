'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface Message {
  id: string;
  from_user: 'daniel' | 'huaiyao';
  message: string;
  is_read: boolean;
  created_at: string;
}

export default function ChatBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    }
    return null;
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch messages
  const fetchMessages = async () => {
    if (!isSupabaseConfigured) return;

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100);

    if (!error && data) {
      setMessages(data);
      updateUnreadCount(data);
    }
  };

  // Update unread count
  const updateUnreadCount = (msgs: Message[]) => {
    if (!currentUser) return;
    const unread = msgs.filter(m => m.from_user !== currentUser && !m.is_read).length;
    setUnreadCount(unread);
  };

  // Mark messages as read
  const markAsRead = async () => {
    if (!currentUser || !isSupabaseConfigured) return;

    await supabase
      .from('chat_messages')
      .update({ is_read: true })
      .eq('is_read', false)
      .neq('from_user', currentUser);

    setUnreadCount(0);
  };

  // Update typing status
  const updateTypingStatus = async (isTyping: boolean) => {
    if (!currentUser || !isSupabaseConfigured) return;

    try {
      await supabase.rpc('set_typing_status', {
        p_player: currentUser,
        p_app_name: 'chat',
        p_is_typing: isTyping,
      });
    } catch (err) {
      console.error('Error updating typing status:', err);
    }
  };

  // Handle typing indicator
  const handleTyping = () => {
    updateTypingStatus(true);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set timeout to clear typing status after 2 seconds of no typing
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 2000);
  };

  // Initial fetch and realtime subscription
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMessages();

    if (!isSupabaseConfigured) return;

    const partner = currentUser === 'daniel' ? 'huaiyao' : 'daniel';

    // Subscribe to new messages and updates (for read receipts)
    const messageChannel = supabase
      .channel('chat_messages')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages(prev => [...prev, newMsg]);
          if (newMsg.from_user !== currentUser) {
            if (isOpen) {
              // Mark as read immediately if chat is open
              markAsRead();
            } else {
              setUnreadCount(prev => prev + 1);
            }
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        (payload) => {
          // Update message when read status changes
          const updatedMsg = payload.new as Message;
          setMessages(prev => prev.map(msg =>
            msg.id === updatedMsg.id ? updatedMsg : msg
          ));
        }
      )
      .subscribe();

    // Subscribe to partner's typing status
    const typingChannel = supabase
      .channel('chat_typing')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'typing_status', filter: `player=eq.${partner}` },
        (payload) => {
          const typingData = payload.new as { is_typing: boolean; app_name: string };
          setPartnerTyping(typingData.is_typing && typingData.app_name === 'chat');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(typingChannel);
      // Clear typing status when component unmounts
      if (currentUser) {
        updateTypingStatus(false);
      }
    };
  }, [currentUser, isOpen]);

  // Scroll to bottom when messages change or chat opens
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Mark as read when opening chat
  useEffect(() => {
    if (isOpen && unreadCount > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      markAsRead();
    }
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Send message
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser || isSending) return;

    const messageText = newMessage.trim();
    setIsSending(true);
    const { error } = await supabase
      .from('chat_messages')
      .insert({
        from_user: currentUser,
        message: messageText,
      });

    if (!error) {
      setNewMessage('');
      // Send push notification to partner
      try {
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'chat_message',
            title: messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText,
            user: currentUser,
          }),
        });
      } catch (err) {
        console.error('Failed to send notification:', err);
      }
    }
    setIsSending(false);
  };

  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  // Don't render if no user selected
  if (!currentUser) return null;

  return (
    <>
      {/* Floating bubble button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 left-6 z-50 w-14 h-14 bg-gradient-to-br from-pink-500 to-rose-500 rounded-full shadow-lg flex items-center justify-center text-white hover:shadow-xl transition-shadow"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </>
        )}
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 left-6 z-50 w-80 sm:w-96 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(100vh - 140px)' }}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-pink-500 to-rose-500 p-4 text-white">
              <div className="flex items-center justify-between">
                <a href="/profile" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-lg">
                    {currentUser === 'daniel' ? '🐰' : '🦊'}
                  </div>
                  <div>
                    <h3 className="font-semibold">{partnerName}</h3>
                    <p className="text-xs text-white/70">View profiles</p>
                  </div>
                </a>
                {/* Call buttons */}
                <div className="flex gap-2">
                  {/* WhatsApp Voice Call (unofficial deep link - may work) */}
                  <a
                    href={`whatsapp://call?phone=${currentUser === 'daniel' ? '447774475890' : '447577432052'}`}
                    className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center hover:bg-green-600 transition-colors"
                    title="WhatsApp Call"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                    </svg>
                  </a>
                  {/* WhatsApp Video Call (unofficial deep link - may work) */}
                  <a
                    href={`whatsapp://video?phone=${currentUser === 'daniel' ? '447774475890' : '447577432052'}`}
                    className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center hover:bg-green-600 transition-colors"
                    title="WhatsApp Video"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[400px] bg-gray-50 dark:bg-gray-900">
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 dark:text-gray-500 py-8">
                  <p className="text-2xl mb-2">💬</p>
                  <p className="text-sm">No messages yet</p>
                  <p className="text-xs">Say hi to {partnerName}!</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.from_user === currentUser;
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                          isMe
                            ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-br-md'
                            : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded-bl-md shadow-sm'
                        }`}
                      >
                        <p className="text-sm break-words">{msg.message}</p>
                        <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : ''}`}>
                          <span className={`text-xs ${isMe ? 'text-white/60' : 'text-gray-400'}`}>
                            {formatTime(msg.created_at)}
                          </span>
                          {/* Read/Delivered status - only show on own messages */}
                          {isMe && (
                            <span className={`text-xs ${msg.is_read ? 'text-blue-300' : 'text-white/40'}`}>
                              {msg.is_read ? (
                                // Double tick for read
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M2 12l5 5L18 6" />
                                  <path d="M7 12l5 5L23 6" />
                                </svg>
                              ) : (
                                // Single tick for delivered
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M5 12l5 5L20 7" />
                                </svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              {/* Typing indicator */}
              {partnerTyping && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] px-4 py-2 rounded-2xl bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-bl-md shadow-sm">
                    <div className="flex items-center gap-1">
                      <span className="text-sm">{partnerName} is typing</span>
                      <span className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} className="p-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    handleTyping();
                  }}
                  onBlur={() => updateTypingStatus(false)}
                  placeholder={`Message ${partnerName}...`}
                  className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim() || isSending}
                  className="w-10 h-10 bg-gradient-to-r from-pink-500 to-rose-500 rounded-full flex items-center justify-center text-white disabled:opacity-50 transition-opacity"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
