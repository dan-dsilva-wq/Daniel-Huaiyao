'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { ThemeToggle } from '../components/ThemeToggle';

interface Profile {
  user_name: string;
  display_name: string | null;
  emoji: string | null;
  phone: string | null;
  birthday: string | null;
  favorite_color: string | null;
  favorite_food: string | null;
  favorite_movie: string | null;
  favorite_song: string | null;
  bio: string | null;
}

const EMOJI_OPTIONS = ['🦊', '🐰', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦋', '🌸', '🌺', '🌻', '⭐', '🌙', '❤️', '💜', '💙', '💚', '🧡'];

export default function ProfilePage() {
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [partnerProfile, setPartnerProfile] = useState<Profile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Profile>>({});
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    const user = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(user);
    if (user) {
      fetchProfiles(user);
    }
  }, []);

  const fetchProfiles = async (user: 'daniel' | 'huaiyao') => {
    if (!isSupabaseConfigured) return;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*');

    if (!error && data) {
      const mine = data.find(p => p.user_name === user);
      const partner = data.find(p => p.user_name !== user);
      setMyProfile(mine || null);
      setPartnerProfile(partner || null);
      if (mine) setEditForm(mine);
    }
  };

  const saveProfile = async () => {
    if (!currentUser || !isSupabaseConfigured) return;

    setIsSaving(true);
    const { error } = await supabase
      .from('user_profiles')
      .update({
        display_name: editForm.display_name,
        emoji: editForm.emoji,
        phone: editForm.phone,
        birthday: editForm.birthday,
        favorite_color: editForm.favorite_color,
        favorite_food: editForm.favorite_food,
        favorite_movie: editForm.favorite_movie,
        favorite_song: editForm.favorite_song,
        bio: editForm.bio,
        updated_at: new Date().toISOString(),
      })
      .eq('user_name', currentUser);

    if (!error) {
      setMyProfile(prev => prev ? { ...prev, ...editForm } : null);
      setIsEditing(false);
    }
    setIsSaving(false);
  };

  const formatBirthday = (date: string | null) => {
    if (!date) return 'Not set';
    return new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400">Please select who you are on the home page first.</p>
          <a href="/" className="text-pink-500 hover:text-pink-600 mt-2 inline-block">← Go Home</a>
        </div>
      </div>
    );
  }

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <a href="/" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            ← Home
          </a>
          <ThemeToggle />
        </div>

        <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-white text-center mb-8">
          Profiles
        </h1>

        {/* My Profile */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white">My Profile</h2>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 text-sm bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-300 rounded-lg hover:bg-pink-200 dark:hover:bg-pink-900/50 transition-colors"
              >
                Edit
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-4">
              {/* Emoji picker */}
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Avatar Emoji</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-16 h-16 text-4xl bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    {editForm.emoji || '😊'}
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute top-full left-0 mt-2 p-3 bg-white dark:bg-gray-700 rounded-xl shadow-lg z-10 grid grid-cols-5 gap-2">
                      {EMOJI_OPTIONS.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => {
                            setEditForm(prev => ({ ...prev, emoji }));
                            setShowEmojiPicker(false);
                          }}
                          className="w-10 h-10 text-2xl hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Display name */}
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Display Name</label>
                <input
                  type="text"
                  value={editForm.display_name || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, display_name: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Phone</label>
                <input
                  type="tel"
                  value={editForm.phone || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                  placeholder="+44..."
                />
              </div>

              {/* Birthday */}
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Birthday</label>
                <input
                  type="date"
                  value={editForm.birthday || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, birthday: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                />
              </div>

              {/* Favorites */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Favorite Color</label>
                  <input
                    type="text"
                    value={editForm.favorite_color || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, favorite_color: e.target.value }))}
                    className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Favorite Food</label>
                  <input
                    type="text"
                    value={editForm.favorite_food || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, favorite_food: e.target.value }))}
                    className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Favorite Movie</label>
                  <input
                    type="text"
                    value={editForm.favorite_movie || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, favorite_movie: e.target.value }))}
                    className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Favorite Song</label>
                  <input
                    type="text"
                    value={editForm.favorite_song || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, favorite_song: e.target.value }))}
                    className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white"
                  />
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Bio</label>
                <textarea
                  value={editForm.bio || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 dark:text-white resize-none"
                  placeholder="A little about yourself..."
                />
              </div>

              {/* Save/Cancel buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={saveProfile}
                  disabled={isSaving}
                  className="flex-1 py-3 bg-pink-500 text-white rounded-lg font-medium hover:bg-pink-600 disabled:opacity-50 transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditForm(myProfile || {});
                  }}
                  className="px-6 py-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Profile display */}
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 text-5xl bg-pink-100 dark:bg-pink-900/30 rounded-2xl flex items-center justify-center">
                  {myProfile?.emoji || '😊'}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-800 dark:text-white">
                    {myProfile?.display_name || currentUser}
                  </h3>
                  {myProfile?.bio && (
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{myProfile.bio}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                {myProfile?.phone && (
                  <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Phone</span>
                    <p className="text-gray-800 dark:text-white">{myProfile.phone}</p>
                  </div>
                )}
                {myProfile?.birthday && (
                  <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Birthday</span>
                    <p className="text-gray-800 dark:text-white">{formatBirthday(myProfile.birthday)}</p>
                  </div>
                )}
                {myProfile?.favorite_color && (
                  <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Color</span>
                    <p className="text-gray-800 dark:text-white">{myProfile.favorite_color}</p>
                  </div>
                )}
                {myProfile?.favorite_food && (
                  <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Food</span>
                    <p className="text-gray-800 dark:text-white">{myProfile.favorite_food}</p>
                  </div>
                )}
                {myProfile?.favorite_movie && (
                  <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Movie</span>
                    <p className="text-gray-800 dark:text-white">{myProfile.favorite_movie}</p>
                  </div>
                )}
                {myProfile?.favorite_song && (
                  <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Song</span>
                    <p className="text-gray-800 dark:text-white">{myProfile.favorite_song}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>

        {/* Partner's Profile */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
        >
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{partnerName}'s Profile</h2>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 text-5xl bg-purple-100 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center">
                {partnerProfile?.emoji || '😊'}
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-800 dark:text-white">
                  {partnerProfile?.display_name || partnerName}
                </h3>
                {partnerProfile?.bio && (
                  <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{partnerProfile.bio}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              {partnerProfile?.birthday && (
                <div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Birthday</span>
                  <p className="text-gray-800 dark:text-white">{formatBirthday(partnerProfile.birthday)}</p>
                </div>
              )}
              {partnerProfile?.favorite_color && (
                <div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Color</span>
                  <p className="text-gray-800 dark:text-white">{partnerProfile.favorite_color}</p>
                </div>
              )}
              {partnerProfile?.favorite_food && (
                <div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Food</span>
                  <p className="text-gray-800 dark:text-white">{partnerProfile.favorite_food}</p>
                </div>
              )}
              {partnerProfile?.favorite_movie && (
                <div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Movie</span>
                  <p className="text-gray-800 dark:text-white">{partnerProfile.favorite_movie}</p>
                </div>
              )}
              {partnerProfile?.favorite_song && (
                <div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">Favorite Song</span>
                  <p className="text-gray-800 dark:text-white">{partnerProfile.favorite_song}</p>
                </div>
              )}
            </div>

            {!partnerProfile?.bio && !partnerProfile?.favorite_color && !partnerProfile?.birthday && (
              <p className="text-gray-400 dark:text-gray-500 text-sm text-center py-4">
                {partnerName} hasn't filled out their profile yet
              </p>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
