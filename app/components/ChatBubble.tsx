'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getCurrentUser, type CurrentUser } from '@/lib/user-session';

interface Message {
  id: string;
  from_user: CurrentUser;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface MessageReaction {
  id: string;
  message_id: string;
  user_name: CurrentUser;
  emoji: string;
  created_at: string;
}

const REACTION_OPTIONS = ['❤️', '😂', '😍', '👍', '🔥', '🥹', '🎉'];

function mergeMessages(base: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const message of base) {
    map.set(message.id, message);
  }
  for (const message of incoming) {
    map.set(message.id, message);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export default function ChatBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, MessageReaction[]>>({});
  const [newMessage, setNewMessage] = useState('');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() =>
    typeof window === 'undefined' ? null : getCurrentUser()
  );
  const [isSending, setIsSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const syncUser = () => {
      setCurrentUser(getCurrentUser());
    };
    window.addEventListener('storage', syncUser);
    return () => {
      window.removeEventListener('storage', syncUser);
    };
  }, []);

  const unreadIds = useMemo(() => {
    if (!currentUser) return [];
    return messages
      .filter((msg) => msg.from_user !== currentUser && !msg.is_read)
      .map((msg) => msg.id);
  }, [messages, currentUser]);

  const unreadCount = unreadIds.length;

  const fetchMessages = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(200);

    if (!error && data) {
      const mergedMessages = mergeMessages([], data as Message[]);
      setMessages(mergedMessages);

      const messageIds = mergedMessages.map((message) => message.id);
      if (messageIds.length === 0) {
        setReactionsByMessage({});
        return;
      }

      const { data: reactions, error: reactionsError } = await supabase
        .from('chat_message_reactions')
        .select('*')
        .in('message_id', messageIds);
      if (!reactionsError && reactions) {
        const grouped: Record<string, MessageReaction[]> = {};
        for (const reaction of reactions as MessageReaction[]) {
          if (!grouped[reaction.message_id]) {
            grouped[reaction.message_id] = [];
          }
          grouped[reaction.message_id].push(reaction);
        }
        setReactionsByMessage(grouped);
      }
    }
  }, []);

  const markAsRead = useCallback(
    async (ids?: string[]) => {
      if (!currentUser || !isSupabaseConfigured) return;

      const targetIds = (ids ?? unreadIds).filter(Boolean);
      if (targetIds.length === 0) return;

      setMessages((prev) =>
        prev.map((message) =>
          targetIds.includes(message.id) ? { ...message, is_read: true } : message
        )
      );

      const { error } = await supabase
        .from('chat_messages')
        .update({ is_read: true })
        .in('id', targetIds)
        .eq('is_read', false)
        .neq('from_user', currentUser);

      if (error) {
        console.error('Failed to mark messages as read:', error);
        await fetchMessages();
      }
    },
    [currentUser, unreadIds, fetchMessages]
  );

  const updateTypingStatus = useCallback(
    async (isTyping: boolean) => {
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
    },
    [currentUser]
  );

  const handleTyping = useCallback(() => {
    void updateTypingStatus(true);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      void updateTypingStatus(false);
    }, 2000);
  }, [updateTypingStatus]);

  useEffect(() => {
    if (!isSupabaseConfigured || !currentUser) return;

    const partner = currentUser === 'daniel' ? 'huaiyao' : 'daniel';

    queueMicrotask(() => {
      void fetchMessages();
    });

    const messageChannel = supabase
      .channel('chat_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const newMessage = payload.new as Message;
        setMessages((prev) => mergeMessages(prev, [newMessage]));
        if (newMessage.from_user !== currentUser && isOpen) {
          void markAsRead([newMessage.id]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (payload) => {
        const updatedMessage = payload.new as Message;
        setMessages((prev) => mergeMessages(prev, [updatedMessage]));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void fetchMessages();
        }
      });

    const reactionChannel = supabase
      .channel('chat_message_reactions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_message_reactions' },
        (payload) => {
          const reaction = (payload.new || payload.old) as MessageReaction;
          const messageId = reaction?.message_id;
          if (!messageId) return;

          setReactionsByMessage((prev) => {
            const current = prev[messageId] || [];
            if (payload.eventType === 'DELETE') {
              return {
                ...prev,
                [messageId]: current.filter((item) => item.id !== reaction.id),
              };
            }

            const withoutOld = current.filter((item) => item.id !== reaction.id);
            const merged = [...withoutOld, payload.new as MessageReaction].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return {
              ...prev,
              [messageId]: merged,
            };
          });
        }
      )
      .subscribe();

    const typingChannel = supabase
      .channel('chat_typing')
      .on(
        'postgres_changes',
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
      supabase.removeChannel(reactionChannel);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      void updateTypingStatus(false);
    };
  }, [currentUser, fetchMessages, isOpen, markAsRead, updateTypingStatus]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    inputRef.current?.focus();
    if (unreadCount > 0) {
      queueMicrotask(() => {
        void markAsRead();
      });
    }
  }, [isOpen, unreadCount, markAsRead, currentUser]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser || isSending || !isSupabaseConfigured) return;

    const messageText = newMessage.trim();
    setIsSending(true);

    const { error } = await supabase.from('chat_messages').insert({
      from_user: currentUser,
      message: messageText,
    });

    if (!error) {
      setNewMessage('');
      try {
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'chat_message',
            title: messageText.length > 50 ? `${messageText.substring(0, 50)}...` : messageText,
            user: currentUser,
          }),
        });
      } catch (err) {
        console.error('Failed to send notification:', err);
      }
    } else {
      console.error('Failed to send message:', error);
      await fetchMessages();
    }

    setIsSending(false);
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!currentUser || !isSupabaseConfigured) return;

    const existingReaction = (reactionsByMessage[messageId] || []).find(
      (reaction) => reaction.user_name === currentUser
    );

    if (existingReaction?.emoji === emoji) {
      const { error } = await supabase
        .from('chat_message_reactions')
        .delete()
        .eq('id', existingReaction.id);
      if (error) {
        console.error('Failed to remove reaction:', error);
      } else {
        setReactionPickerFor(null);
      }
      return;
    }

    const { error } = await supabase.from('chat_message_reactions').upsert(
      {
        message_id: messageId,
        user_name: currentUser,
        emoji,
      },
      { onConflict: 'message_id,user_name' }
    );

    if (error) {
      console.error('Failed to save reaction:', error);
      return;
    }

    setReactionPickerFor(null);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  if (!currentUser) return null;

  return (
    <>
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

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 left-6 z-50 w-80 sm:w-96 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(100vh - 140px)' }}
          >
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
                <div className="flex gap-2">
                  <a
                    href={`whatsapp://call?phone=${currentUser === 'daniel' ? '447774475890' : '447577432052'}`}
                    className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center hover:bg-green-600 transition-colors"
                    title="WhatsApp Call"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
                    </svg>
                  </a>
                  <a
                    href={`whatsapp://video?phone=${currentUser === 'daniel' ? '447774475890' : '447577432052'}`}
                    className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center hover:bg-green-600 transition-colors"
                    title="WhatsApp Video"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>

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
                  const reactions = reactionsByMessage[msg.id] || [];
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[85%]">
                        <div
                          className={`px-4 py-2 rounded-2xl ${
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
                            {isMe && (
                              <span className={`text-xs ${msg.is_read ? 'text-blue-300' : 'text-white/40'}`}>
                                {msg.is_read ? (
                                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M2 12l5 5L18 6" />
                                    <path d="M7 12l5 5L23 6" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M5 12l5 5L20 7" />
                                  </svg>
                                )}
                              </span>
                            )}
                          </div>
                        </div>

                        {reactions.length > 0 && (
                          <div className={`mt-1 flex flex-wrap gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            {reactions.map((reaction) => (
                              <button
                                key={reaction.id}
                                type="button"
                                onClick={() => toggleReaction(msg.id, reaction.emoji)}
                                className={`px-2 py-0.5 rounded-full text-xs border ${
                                  reaction.user_name === currentUser
                                    ? 'bg-pink-100 border-pink-300 text-pink-700 dark:bg-pink-900/40 dark:text-pink-200'
                                    : 'bg-white border-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600'
                                }`}
                                title={reaction.user_name === currentUser ? 'Tap to remove your reaction' : undefined}
                              >
                                {reaction.emoji}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className={`mt-1 ${isMe ? 'text-right' : 'text-left'}`}>
                          <button
                            type="button"
                            onClick={() =>
                              setReactionPickerFor((current) => (current === msg.id ? null : msg.id))
                            }
                            className="text-xs text-gray-400 hover:text-pink-500 transition-colors"
                          >
                            React
                          </button>
                        </div>

                        {reactionPickerFor === msg.id && (
                          <div className={`mt-1 flex flex-wrap gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            {REACTION_OPTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => toggleReaction(msg.id, emoji)}
                                className="px-2 py-1 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-sm hover:scale-105 transition-transform"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
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
                  onBlur={() => {
                    void updateTypingStatus(false);
                  }}
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
