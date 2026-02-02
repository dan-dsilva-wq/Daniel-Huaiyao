'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '../components/ThemeToggle';

type MemoryType = 'milestone' | 'note' | 'photo' | 'moment';

interface MemoryPhoto {
  id: string;
  photo_url: string;
  caption: string | null;
}

interface Memory {
  id: string;
  created_by: 'daniel' | 'huaiyao';
  memory_type: MemoryType;
  title: string;
  description: string | null;
  memory_date: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  is_pinned: boolean;
  created_at: string;
  photos: MemoryPhoto[];
  tags: string[];
}

const MEMORY_TYPE_CONFIG: Record<MemoryType, { emoji: string; label: string; color: string }> = {
  milestone: { emoji: '🏆', label: 'Milestone', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  note: { emoji: '📝', label: 'Note', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  photo: { emoji: '📸', label: 'Photo', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300' },
  moment: { emoji: '✨', label: 'Moment', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
};

export default function MemoriesPage() {
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [filterType, setFilterType] = useState<MemoryType | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'grid'>('timeline');

  // Form state
  const [formType, setFormType] = useState<MemoryType>('moment');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formLocation, setFormLocation] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formPhotos, setFormPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchMemories = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_memories', {
        p_limit: 100,
        p_offset: 0,
        p_type: filterType,
        p_tag: filterTag,
      });

      if (error) throw error;

      setMemories(data.memories || []);
      setAllTags(data.all_tags || []);
    } catch (error) {
      console.error('Error fetching memories:', error);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterTag]);

  useEffect(() => {
    const saved = localStorage.getItem('currentUser');
    if (saved === 'daniel' || saved === 'huaiyao') {
      setCurrentUser(saved);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchMemories();
    }
  }, [currentUser, fetchMemories]);

  const handleUserSelect = (user: 'daniel' | 'huaiyao') => {
    localStorage.setItem('currentUser', user);
    setCurrentUser(user);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 5 photos max
    const newPhotos = [...formPhotos, ...files].slice(0, 5);
    setFormPhotos(newPhotos);

    // Create preview URLs
    const newPreviewUrls = newPhotos.map((file) => URL.createObjectURL(file));
    // Cleanup old preview URLs
    photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPhotoPreviewUrls(newPreviewUrls);
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviewUrls[index]);
    setFormPhotos(formPhotos.filter((_, i) => i !== index));
    setPhotoPreviewUrls(photoPreviewUrls.filter((_, i) => i !== index));
  };

  const uploadPhotos = async (memoryId: string): Promise<string[]> => {
    const uploadedUrls: string[] = [];

    for (const file of formPhotos) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${memoryId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('memory-photos')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Error uploading photo:', uploadError);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('memory-photos')
        .getPublicUrl(fileName);

      uploadedUrls.push(publicUrl);
    }

    return uploadedUrls;
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !formTitle.trim()) return;

    setSubmitting(true);
    try {
      const tags = formTags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);

      const { data: memoryData, error } = await supabase.rpc('add_memory', {
        p_created_by: currentUser,
        p_memory_type: formType,
        p_title: formTitle.trim(),
        p_description: formDescription.trim() || null,
        p_memory_date: formDate,
        p_location_name: formLocation.trim() || null,
        p_tags: tags,
      });

      if (error) throw error;

      // Upload photos if any
      if (formPhotos.length > 0 && memoryData?.id) {
        setUploadingPhotos(true);
        const photoUrls = await uploadPhotos(memoryData.id);

        // Add photo records to database
        for (const photoUrl of photoUrls) {
          await supabase.from('memory_photos').insert({
            memory_id: memoryData.id,
            photo_url: photoUrl,
          });
        }
        setUploadingPhotos(false);
      }

      // Reset form
      setFormType('moment');
      setFormTitle('');
      setFormDescription('');
      setFormDate(new Date().toISOString().split('T')[0]);
      setFormLocation('');
      setFormTags('');
      setFormPhotos([]);
      photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
      setPhotoPreviewUrls([]);
      setShowAddModal(false);

      // Refresh memories
      fetchMemories();
    } catch (error) {
      console.error('Error adding memory:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePin = async (memoryId: string) => {
    try {
      const { error } = await supabase.rpc('toggle_memory_pin', {
        p_memory_id: memoryId,
      });

      if (error) throw error;
      fetchMemories();
    } catch (error) {
      console.error('Error toggling pin:', error);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    if (!confirm('Are you sure you want to delete this memory?')) return;

    try {
      const { error } = await supabase.rpc('delete_memory', {
        p_memory_id: memoryId,
      });

      if (error) throw error;
      setSelectedMemory(null);
      fetchMemories();
    } catch (error) {
      console.error('Error deleting memory:', error);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  // Group memories by month/year for timeline view
  const groupedMemories = memories.reduce((groups, memory) => {
    const date = new Date(memory.memory_date + 'T00:00:00');
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) {
      groups[key] = {
        label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        memories: [],
      };
    }
    groups[key].memories.push(memory);
    return groups;
  }, {} as Record<string, { label: string; memories: Memory[] }>);

  // User selection
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 dark:from-gray-900 dark:to-purple-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md w-full text-center"
        >
          <h1 className="text-3xl font-bold mb-2 dark:text-white">Memory Timeline</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-8">Who&apos;s reminiscing?</p>
          <div className="flex gap-4 justify-center">
            {(['daniel', 'huaiyao'] as const).map((user) => (
              <motion.button
                key={user}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleUserSelect(user)}
                className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium capitalize shadow-lg"
              >
                {user}
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 dark:from-gray-900 dark:to-purple-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 dark:from-gray-900 dark:to-purple-950">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-800/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4">
          {/* Top row: Back button, title, and add button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              <Link
                href="/"
                className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl sm:text-2xl font-bold dark:text-white">Memories</h1>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <ThemeToggle />

              {/* View toggle - icon only on mobile, text on larger screens */}
              <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 sm:p-1">
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm transition-colors ${
                    viewMode === 'timeline'
                      ? 'bg-white dark:bg-gray-600 shadow text-purple-600 dark:text-purple-300'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  title="Timeline view"
                >
                  <span className="hidden sm:inline">Timeline</span>
                  <span className="sm:hidden">📅</span>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-white dark:bg-gray-600 shadow text-purple-600 dark:text-purple-300'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  title="Grid view"
                >
                  <span className="hidden sm:inline">Grid</span>
                  <span className="sm:hidden">⊞</span>
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowAddModal(true)}
                className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-purple-500 text-white rounded-lg font-medium shadow-lg text-sm"
              >
                <span className="hidden sm:inline">+ Add Memory</span>
                <span className="sm:hidden">+</span>
              </motion.button>
            </div>
          </div>

          {/* Filters - horizontally scrollable on mobile */}
          <div className="mt-3 sm:mt-4 -mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 pb-1 min-w-max">
              {/* Type filters */}
              <button
                onClick={() => setFilterType(null)}
                className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
                  filterType === null
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}
              >
                All Types
              </button>
              {Object.entries(MEMORY_TYPE_CONFIG).map(([type, config]) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type as MemoryType)}
                  className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
                    filterType === type
                      ? 'bg-purple-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {config.emoji} {config.label}
                </button>
              ))}

              {/* Tag filters */}
              {allTags.length > 0 && (
                <>
                  <span className="text-gray-300 dark:text-gray-600 self-center">|</span>
                  <button
                    onClick={() => setFilterTag(null)}
                    className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
                      filterTag === null && filterType !== null
                        ? 'bg-pink-500 text-white'
                        : filterTag === null
                        ? 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    All Tags
                  </button>
                  {allTags.slice(0, 5).map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setFilterTag(tag)}
                      className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
                        filterTag === tag
                          ? 'bg-pink-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      #{tag}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {memories.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <div className="text-6xl mb-4">📸</div>
            <h2 className="text-2xl font-bold mb-2 dark:text-white">No memories yet</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Start capturing your special moments together!
            </p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowAddModal(true)}
              className="px-6 py-3 bg-purple-500 text-white rounded-xl font-medium"
            >
              Add Your First Memory
            </motion.button>
          </motion.div>
        ) : viewMode === 'timeline' ? (
          // Timeline View
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-0.5 bg-purple-200 dark:bg-purple-800" />

            {Object.entries(groupedMemories)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([key, group], groupIndex) => (
                <div key={key} className="mb-8">
                  {/* Month header */}
                  <div className="relative flex items-center mb-4">
                    <div className="absolute left-4 md:left-1/2 -translate-x-1/2 w-4 h-4 bg-purple-500 rounded-full border-4 border-white dark:border-gray-900" />
                    <div className="ml-12 md:ml-0 md:w-1/2 md:pr-8 md:text-right">
                      <span className="inline-block px-4 py-1 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-full font-medium">
                        {group.label}
                      </span>
                    </div>
                  </div>

                  {/* Memories in this month */}
                  {group.memories.map((memory, index) => (
                    <motion.div
                      key={memory.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (groupIndex * 0.1) + (index * 0.05) }}
                      className={`relative mb-4 ${
                        index % 2 === 0 ? 'md:pr-8 md:ml-auto md:w-1/2 md:pl-8' : 'md:pl-8 md:w-1/2 md:pr-8 md:text-right'
                      } ml-12 md:ml-0`}
                    >
                      {/* Timeline dot */}
                      <div className="absolute left-[-28px] md:left-auto md:right-auto top-4 w-2 h-2 bg-purple-300 dark:bg-purple-600 rounded-full md:-translate-x-1/2 md:left-0" />

                      <motion.div
                        whileHover={{ scale: 1.02 }}
                        onClick={() => setSelectedMemory(memory)}
                        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 cursor-pointer hover:shadow-xl transition-shadow"
                      >
                        <div className={`flex items-start gap-3 ${index % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
                          <span className="text-2xl">{MEMORY_TYPE_CONFIG[memory.memory_type].emoji}</span>
                          <div className={`flex-1 ${index % 2 === 1 ? 'md:text-right' : ''}`}>
                            <div className="flex items-center gap-2 mb-1">
                              {memory.is_pinned && <span className="text-amber-500">📌</span>}
                              <h3 className="font-semibold dark:text-white">{memory.title}</h3>
                            </div>
                            {memory.description && (
                              <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-2">
                                {memory.description}
                              </p>
                            )}
                            <div className={`flex items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400 ${index % 2 === 1 ? 'md:justify-end' : ''}`}>
                              <span>{formatDate(memory.memory_date)}</span>
                              {memory.location_name && (
                                <>
                                  <span>•</span>
                                  <span>📍 {memory.location_name}</span>
                                </>
                              )}
                            </div>
                            {memory.tags.length > 0 && (
                              <div className={`flex flex-wrap gap-1 mt-2 ${index % 2 === 1 ? 'md:justify-end' : ''}`}>
                                {memory.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  ))}
                </div>
              ))}
          </div>
        ) : (
          // Grid View
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {memories.map((memory, index) => (
              <motion.div
                key={memory.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.02 }}
                onClick={() => setSelectedMemory(memory)}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 cursor-pointer hover:shadow-xl transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <span className="text-3xl">{MEMORY_TYPE_CONFIG[memory.memory_type].emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {memory.is_pinned && <span className="text-amber-500">📌</span>}
                      <h3 className="font-semibold dark:text-white truncate">{memory.title}</h3>
                    </div>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${MEMORY_TYPE_CONFIG[memory.memory_type].color}`}>
                      {MEMORY_TYPE_CONFIG[memory.memory_type].label}
                    </span>
                  </div>
                </div>

                {memory.description && (
                  <p className="text-gray-600 dark:text-gray-400 text-sm mt-3 line-clamp-2">
                    {memory.description}
                  </p>
                )}

                <div className="flex items-center justify-between mt-3 text-xs text-gray-500 dark:text-gray-400">
                  <span>{getRelativeTime(memory.memory_date)}</span>
                  <span className="capitalize">{memory.created_by}</span>
                </div>

                {memory.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {memory.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs"
                      >
                        #{tag}
                      </span>
                    ))}
                    {memory.tags.length > 3 && (
                      <span className="text-gray-400 text-xs">+{memory.tags.length - 3}</span>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Add Memory Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
            >
              <div className="p-4 sm:p-6">
                <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 dark:text-white">Add Memory</h2>

                <form onSubmit={handleAddMemory} className="space-y-4">
                  {/* Memory Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(MEMORY_TYPE_CONFIG).map(([type, config]) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormType(type as MemoryType)}
                          className={`p-3 rounded-lg border-2 transition-colors text-left ${
                            formType === type
                              ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30'
                              : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        >
                          <span className="text-xl mr-2">{config.emoji}</span>
                          <span className="font-medium dark:text-white">{config.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="What's this memory about?"
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Description (optional)
                    </label>
                    <textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      placeholder="Tell the story..."
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white resize-none"
                    />
                  </div>

                  {/* Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Location (optional)
                    </label>
                    <input
                      type="text"
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      placeholder="Where did this happen?"
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tags (optional, comma-separated)
                    </label>
                    <input
                      type="text"
                      value={formTags}
                      onChange={(e) => setFormTags(e.target.value)}
                      placeholder="travel, anniversary, funny"
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                  </div>

                  {/* Photos */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Photos (optional, max 5)
                    </label>
                    <div className="space-y-3">
                      {photoPreviewUrls.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {photoPreviewUrls.map((url, index) => (
                            <div key={index} className="relative aspect-square rounded-lg overflow-hidden">
                              <img
                                src={url}
                                alt={`Preview ${index + 1}`}
                                className="w-full h-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => removePhoto(index)}
                                className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {formPhotos.length < 5 && (
                        <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-purple-500 dark:hover:border-purple-400 transition-colors">
                          <div className="text-center">
                            <span className="text-2xl">📷</span>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              Add photos
                            </p>
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handlePhotoSelect}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowAddModal(false)}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !formTitle.trim()}
                      className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-600 transition-colors"
                    >
                      {submitting
                        ? uploadingPhotos
                          ? 'Uploading photos...'
                          : 'Saving...'
                        : 'Save Memory'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Memory Detail Modal */}
      <AnimatePresence>
        {selectedMemory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setSelectedMemory(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
            >
              <div className="p-4 sm:p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <span className="text-3xl sm:text-4xl flex-shrink-0">{MEMORY_TYPE_CONFIG[selectedMemory.memory_type].emoji}</span>
                    <div className="min-w-0">
                      <h2 className="text-lg sm:text-2xl font-bold dark:text-white break-words">{selectedMemory.title}</h2>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs mt-1 ${MEMORY_TYPE_CONFIG[selectedMemory.memory_type].color}`}>
                        {MEMORY_TYPE_CONFIG[selectedMemory.memory_type].label}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedMemory(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Content */}
                {selectedMemory.description && (
                  <p className="text-gray-700 dark:text-gray-300 mb-4 whitespace-pre-wrap">
                    {selectedMemory.description}
                  </p>
                )}

                {/* Meta info */}
                <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
                  <div className="flex items-center gap-2">
                    <span>📅</span>
                    <span>{formatDate(selectedMemory.memory_date)}</span>
                    <span className="text-gray-400">({getRelativeTime(selectedMemory.memory_date)})</span>
                  </div>
                  {selectedMemory.location_name && (
                    <div className="flex items-center gap-2">
                      <span>📍</span>
                      <span>{selectedMemory.location_name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span>👤</span>
                    <span className="capitalize">Added by {selectedMemory.created_by}</span>
                  </div>
                </div>

                {/* Tags */}
                {selectedMemory.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {selectedMemory.tags.map((tag) => (
                      <span
                        key={tag}
                        onClick={() => {
                          setFilterTag(tag);
                          setSelectedMemory(null);
                        }}
                        className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full text-sm cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => handleTogglePin(selectedMemory.id)}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                      selectedMemory.is_pinned
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    📌 {selectedMemory.is_pinned ? 'Unpin' : 'Pin'}
                  </button>
                  {selectedMemory.created_by === currentUser && (
                    <button
                      onClick={() => handleDeleteMemory(selectedMemory.id)}
                      className="px-4 py-2 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-lg font-medium hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
