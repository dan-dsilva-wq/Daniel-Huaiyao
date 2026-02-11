'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';

interface ImportantDate {
  id: string;
  title: string;
  event_date: string;
  is_recurring: boolean;
  category: 'anniversary' | 'birthday' | 'trip' | 'event';
  emoji: string;
  created_by: 'daniel' | 'huaiyao';
  days_until: number;
  next_occurrence: string;
}

interface TimelineItem {
  id: string;
  event_id: string;
  time_slot: string;
  title: string;
  description: string | null;
  location: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
}

interface ChecklistItem {
  id: string;
  event_id: string;
  title: string;
  is_checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
  created_by: string;
  created_at: string;
}

interface EventPlan {
  timeline: TimelineItem[];
  checklist: ChecklistItem[];
  notes: string | null;
  notes_updated_by: string | null;
  notes_updated_at: string | null;
}

type Tab = 'timeline' | 'checklist' | 'notes';

interface EventDetailModalProps {
  event: ImportantDate;
  currentUser: 'daniel' | 'huaiyao';
  onClose: () => void;
  onDelete: (id: string, title: string) => void;
  onNotify: (action: string, title: string) => void;
}

export function EventDetailModal({ event, currentUser, onClose, onDelete, onNotify }: EventDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('timeline');
  const [plan, setPlan] = useState<EventPlan | null>(null);
  const [loading, setLoading] = useState(true);

  // Timeline state
  const [showAddTimeline, setShowAddTimeline] = useState(false);
  const [newTimeSlot, setNewTimeSlot] = useState('');
  const [newTimeTitle, setNewTimeTitle] = useState('');
  const [newTimeDescription, setNewTimeDescription] = useState('');
  const [newTimeLocation, setNewTimeLocation] = useState('');
  const [addingTimeline, setAddingTimeline] = useState(false);

  // Checklist state
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [addingChecklist, setAddingChecklist] = useState(false);

  // Notes state
  const [notes, setNotes] = useState('');
  const [notesSaveStatus, setNotesSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const notesTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPlan = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_event_plan', { p_event_id: event.id });
      if (error) throw error;
      setPlan(data as EventPlan);
      if (data?.notes) {
        setNotes(data.notes);
      }
    } catch (error) {
      console.error('Error fetching event plan:', error);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (notesTimerRef.current) {
        clearTimeout(notesTimerRef.current);
      }
    };
  }, []);

  const formatDaysUntil = (days: number) => {
    if (days === 0) return 'Today!';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return `${Math.abs(days)} days ago`;
    return `${days} days away`;
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${minutes} ${ampm}`;
  };

  // Convert DB time "HH:MM:SS" to input value "HH:MM"
  const timeToInputValue = (timeStr: string) => {
    const parts = timeStr.split(':');
    return `${parts[0]}:${parts[1]}`;
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  // Timeline handlers
  const addTimelineItem = async () => {
    if (!newTimeSlot || !newTimeTitle.trim()) return;
    setAddingTimeline(true);
    try {
      const { error } = await supabase.rpc('add_timeline_item', {
        p_event_id: event.id,
        p_time_slot: newTimeSlot,
        p_title: newTimeTitle.trim(),
        p_description: newTimeDescription.trim() || null,
        p_location: newTimeLocation.trim() || null,
        p_created_by: currentUser,
      });
      if (error) throw error;
      setNewTimeSlot('');
      setNewTimeTitle('');
      setNewTimeDescription('');
      setNewTimeLocation('');
      setShowAddTimeline(false);
      onNotify('event_plan_updated', event.title);
      fetchPlan();
    } catch (error) {
      console.error('Error adding timeline item:', error);
    } finally {
      setAddingTimeline(false);
    }
  };

  const updateTimelineItem = async (itemId: string, timeSlot: string, title: string, description: string, location: string) => {
    try {
      const { error } = await supabase.rpc('update_timeline_item', {
        p_item_id: itemId,
        p_time_slot: timeSlot,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_location: location.trim() || null,
      });
      if (error) throw error;
      fetchPlan();
    } catch (error) {
      console.error('Error updating timeline item:', error);
    }
  };

  const deleteTimelineItem = async (itemId: string) => {
    try {
      const { error } = await supabase.rpc('delete_timeline_item', { p_item_id: itemId });
      if (error) throw error;
      fetchPlan();
    } catch (error) {
      console.error('Error deleting timeline item:', error);
    }
  };

  // Checklist handlers
  const addChecklistItem = async () => {
    if (!newChecklistTitle.trim()) return;
    setAddingChecklist(true);
    try {
      const { error } = await supabase.rpc('add_checklist_item', {
        p_event_id: event.id,
        p_title: newChecklistTitle.trim(),
        p_created_by: currentUser,
      });
      if (error) throw error;
      setNewChecklistTitle('');
      onNotify('event_plan_updated', event.title);
      fetchPlan();
    } catch (error) {
      console.error('Error adding checklist item:', error);
    } finally {
      setAddingChecklist(false);
    }
  };

  const toggleChecklistItem = async (itemId: string) => {
    try {
      const { error } = await supabase.rpc('toggle_checklist_item', {
        p_item_id: itemId,
        p_checked_by: currentUser,
      });
      if (error) throw error;
      fetchPlan();
    } catch (error) {
      console.error('Error toggling checklist item:', error);
    }
  };

  const updateChecklistItem = async (itemId: string, title: string) => {
    try {
      const { error } = await supabase.rpc('update_checklist_item', {
        p_item_id: itemId,
        p_title: title.trim(),
      });
      if (error) throw error;
      fetchPlan();
    } catch (error) {
      console.error('Error updating checklist item:', error);
    }
  };

  const deleteChecklistItem = async (itemId: string) => {
    try {
      const { error } = await supabase.rpc('delete_checklist_item', { p_item_id: itemId });
      if (error) throw error;
      fetchPlan();
    } catch (error) {
      console.error('Error deleting checklist item:', error);
    }
  };

  // Notes handler with debounced auto-save
  const handleNotesChange = (value: string) => {
    setNotes(value);
    setNotesSaveStatus('saving');

    if (notesTimerRef.current) {
      clearTimeout(notesTimerRef.current);
    }

    notesTimerRef.current = setTimeout(async () => {
      try {
        const { error } = await supabase.rpc('update_event_notes', {
          p_event_id: event.id,
          p_notes: value,
          p_updated_by: currentUser,
        });
        if (error) throw error;
        setNotesSaveStatus('saved');
        setPlan((prev) => prev ? {
          ...prev,
          notes: value,
          notes_updated_by: currentUser,
          notes_updated_at: new Date().toISOString(),
        } : prev);
        setTimeout(() => setNotesSaveStatus('idle'), 2000);
      } catch (error) {
        console.error('Error saving notes:', error);
        setNotesSaveStatus('idle');
      }
    }, 1000);
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${event.title}" and all its planning data?`)) return;
    onDelete(event.id, event.title);
    onClose();
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'timeline', label: 'Timeline', count: plan?.timeline.length },
    { key: 'checklist', label: 'Checklist', count: plan?.checklist.length },
    { key: 'notes', label: 'Notes' },
  ];

  const checkedCount = plan?.checklist.filter((c) => c.is_checked).length ?? 0;
  const totalChecklist = plan?.checklist.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 top-0 sm:top-8 bg-white dark:bg-gray-900 sm:rounded-t-2xl
                   flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm font-medium
                         transition-colors touch-manipulation"
            >
              ← Back
            </button>
            <button
              onClick={handleDelete}
              className="text-gray-400 hover:text-red-500 transition-colors touch-manipulation p-1"
              title="Delete event"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          <div className="text-center">
            <span className="text-3xl">{event.emoji}</span>
            <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100 mt-1">
              {event.title}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {new Date(event.next_occurrence).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
              {' · '}
              {formatDaysUntil(event.days_until)}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex mt-4 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {tab.label}
                {tab.key === 'checklist' && totalChecklist > 0 && (
                  <span className="ml-1 text-xs opacity-60">{checkedCount}/{totalChecklist}</span>
                )}
                {tab.key === 'timeline' && (tab.count ?? 0) > 0 && (
                  <span className="ml-1 text-xs opacity-60">{tab.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full"
              />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {activeTab === 'timeline' && (
                <motion.div
                  key="timeline"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                >
                  <TimelineTab
                    items={plan?.timeline ?? []}
                    showAdd={showAddTimeline}
                    onShowAdd={setShowAddTimeline}
                    newTimeSlot={newTimeSlot}
                    onNewTimeSlot={setNewTimeSlot}
                    newTitle={newTimeTitle}
                    onNewTitle={setNewTimeTitle}
                    newDescription={newTimeDescription}
                    onNewDescription={setNewTimeDescription}
                    newLocation={newTimeLocation}
                    onNewLocation={setNewTimeLocation}
                    adding={addingTimeline}
                    onAdd={addTimelineItem}
                    onUpdate={updateTimelineItem}
                    onDelete={deleteTimelineItem}
                    formatTime={formatTime}
                    timeToInputValue={timeToInputValue}
                  />
                </motion.div>
              )}

              {activeTab === 'checklist' && (
                <motion.div
                  key="checklist"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                >
                  <ChecklistTab
                    items={plan?.checklist ?? []}
                    newTitle={newChecklistTitle}
                    onNewTitle={setNewChecklistTitle}
                    adding={addingChecklist}
                    onAdd={addChecklistItem}
                    onToggle={toggleChecklistItem}
                    onUpdate={updateChecklistItem}
                    onDelete={deleteChecklistItem}
                  />
                </motion.div>
              )}

              {activeTab === 'notes' && (
                <motion.div
                  key="notes"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                >
                  <NotesTab
                    notes={notes}
                    onChange={handleNotesChange}
                    saveStatus={notesSaveStatus}
                    updatedBy={plan?.notes_updated_by ?? null}
                    updatedAt={plan?.notes_updated_at ?? null}
                    formatTimeAgo={formatTimeAgo}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Shared inline form for timeline items ───────────────

const inputClass = `w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg
                    bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm
                    focus:outline-none focus:ring-2 focus:ring-amber-300`;

function TimelineItemForm({
  timeSlot,
  onTimeSlot,
  title,
  onTitle,
  description,
  onDescription,
  location,
  onLocation,
  saving,
  onSave,
  onCancel,
  saveLabel,
  savingLabel,
}: {
  timeSlot: string;
  onTimeSlot: (v: string) => void;
  title: string;
  onTitle: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  location: string;
  onLocation: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  savingLabel: string;
}) {
  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Time</label>
          <input type="time" value={timeSlot} onChange={(e) => onTimeSlot(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Title</label>
          <input type="text" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="e.g., Dinner" className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description (optional)</label>
        <input type="text" value={description} onChange={(e) => onDescription(e.target.value)} placeholder="e.g., Try the omakase" className={inputClass} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Location (optional)</label>
        <input type="text" value={location} onChange={(e) => onLocation(e.target.value)} placeholder="e.g., Sakura Restaurant" className={inputClass} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800
                     dark:hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!timeSlot || !title.trim() || saving}
          className="flex-1 px-3 py-2 text-sm bg-amber-500 text-white rounded-lg font-medium
                     hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? savingLabel : saveLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Timeline Tab ────────────────────────────────────────

function TimelineTab({
  items,
  showAdd,
  onShowAdd,
  newTimeSlot,
  onNewTimeSlot,
  newTitle,
  onNewTitle,
  newDescription,
  onNewDescription,
  newLocation,
  onNewLocation,
  adding,
  onAdd,
  onUpdate,
  onDelete,
  formatTime,
  timeToInputValue,
}: {
  items: TimelineItem[];
  showAdd: boolean;
  onShowAdd: (v: boolean) => void;
  newTimeSlot: string;
  onNewTimeSlot: (v: string) => void;
  newTitle: string;
  onNewTitle: (v: string) => void;
  newDescription: string;
  onNewDescription: (v: string) => void;
  newLocation: string;
  onNewLocation: (v: string) => void;
  adding: boolean;
  onAdd: () => void;
  onUpdate: (id: string, timeSlot: string, title: string, description: string, location: string) => Promise<void>;
  onDelete: (id: string) => void;
  formatTime: (t: string) => string;
  timeToInputValue: (t: string) => string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editLoc, setEditLoc] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (item: TimelineItem) => {
    setEditingId(item.id);
    setEditTime(timeToInputValue(item.time_slot));
    setEditTitle(item.title);
    setEditDesc(item.description ?? '');
    setEditLoc(item.location ?? '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId || !editTime || !editTitle.trim()) return;
    setSaving(true);
    await onUpdate(editingId, editTime, editTitle, editDesc, editLoc);
    setEditingId(null);
    setSaving(false);
  };

  return (
    <div>
      {items.length === 0 && !showAdd && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">🕐</div>
          <p className="text-sm">No timeline yet. Plan your day!</p>
        </div>
      )}

      {/* Timeline visual */}
      {items.length > 0 && (
        <div className="relative ml-4 pl-6 border-l-2 border-amber-200 dark:border-amber-800 space-y-4 mb-4">
          {items.map((item) => (
            <div key={item.id} className="relative group">
              {/* Dot */}
              <div className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 ${
                editingId === item.id ? 'bg-blue-400' : 'bg-amber-400 dark:bg-amber-500'
              }`} />

              {editingId === item.id ? (
                <TimelineItemForm
                  timeSlot={editTime}
                  onTimeSlot={setEditTime}
                  title={editTitle}
                  onTitle={setEditTitle}
                  description={editDesc}
                  onDescription={setEditDesc}
                  location={editLoc}
                  onLocation={setEditLoc}
                  saving={saving}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  saveLabel="Save"
                  savingLabel="Saving..."
                />
              ) : (
                <div
                  className="flex items-start justify-between cursor-pointer rounded-lg p-1 -m-1
                             hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  onClick={() => startEdit(item)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-0.5">
                      {formatTime(item.time_slot)}
                    </div>
                    <div className="font-medium text-gray-800 dark:text-gray-100">
                      {item.title}
                    </div>
                    {item.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {item.description}
                      </p>
                    )}
                    {item.location && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                        <span>📍</span> {item.location}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500
                               transition-all touch-manipulation flex-shrink-0 ml-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-3"
          >
            <TimelineItemForm
              timeSlot={newTimeSlot}
              onTimeSlot={onNewTimeSlot}
              title={newTitle}
              onTitle={onNewTitle}
              description={newDescription}
              onDescription={onNewDescription}
              location={newLocation}
              onLocation={onNewLocation}
              saving={adding}
              onSave={onAdd}
              onCancel={() => onShowAdd(false)}
              saveLabel="Add"
              savingLabel="Adding..."
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!showAdd && (
        <button
          onClick={() => onShowAdd(true)}
          className="w-full p-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl
                     text-sm text-gray-500 dark:text-gray-400 hover:border-amber-400 hover:text-amber-500
                     dark:hover:border-amber-500 dark:hover:text-amber-400 transition-colors"
        >
          + Add time slot
        </button>
      )}
    </div>
  );
}

// ─── Checklist Tab ────────────────────────────────────────

function ChecklistTab({
  items,
  newTitle,
  onNewTitle,
  adding,
  onAdd,
  onToggle,
  onUpdate,
  onDelete,
}: {
  items: ChecklistItem[];
  newTitle: string;
  onNewTitle: (v: string) => void;
  adding: boolean;
  onAdd: () => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const startEdit = (item: ChecklistItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    await onUpdate(editingId, editTitle);
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  // Focus the edit input when it appears
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingId]);

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTitle.trim()) {
      onAdd();
    }
  };

  return (
    <div>
      {items.length === 0 && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-sm">No items yet. Start your planning checklist!</p>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="group flex items-start gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg
                       border border-gray-100 dark:border-gray-700"
          >
            <button
              onClick={() => onToggle(item.id)}
              className={`flex-shrink-0 w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center
                         transition-colors ${
                item.is_checked
                  ? 'bg-amber-500 border-amber-500 text-white'
                  : 'border-gray-300 dark:border-gray-600 hover:border-amber-400'
              }`}
            >
              {item.is_checked && (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0">
              {editingId === item.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={saveEdit}
                  className="w-full px-2 py-0.5 -mx-2 text-sm border border-amber-300 dark:border-amber-600 rounded
                             bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                             focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              ) : (
                <span
                  onClick={() => startEdit(item)}
                  className={`text-sm cursor-pointer rounded px-1 -mx-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                    item.is_checked
                      ? 'line-through text-gray-400 dark:text-gray-500'
                      : 'text-gray-800 dark:text-gray-100'
                  }`}
                >
                  {item.title}
                </span>
              )}
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                <span className={item.created_by === 'daniel' ? 'text-blue-400' : 'text-rose-400'}>
                  {item.created_by === 'daniel' ? 'Daniel' : 'Huaiyao'}
                </span>
                {item.is_checked && item.checked_by && (
                  <span>
                    {' · checked by '}
                    <span className={item.checked_by === 'daniel' ? 'text-blue-400' : 'text-rose-400'}>
                      {item.checked_by === 'daniel' ? 'Daniel' : 'Huaiyao'}
                    </span>
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => onDelete(item.id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500
                         transition-all touch-manipulation flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Add input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => onNewTitle(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Add a checklist item..."
          className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl
                     bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm
                     focus:outline-none focus:ring-2 focus:ring-amber-300
                     placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <button
          onClick={onAdd}
          disabled={!newTitle.trim() || adding}
          className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium
                     hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? '...' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ─── Notes Tab ────────────────────────────────────────────

function NotesTab({
  notes,
  onChange,
  saveStatus,
  updatedBy,
  updatedAt,
  formatTimeAgo,
}: {
  notes: string;
  onChange: (v: string) => void;
  saveStatus: 'idle' | 'saving' | 'saved';
  updatedBy: string | null;
  updatedAt: string | null;
  formatTimeAgo: (d: string) => string;
}) {
  return (
    <div>
      <textarea
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Share notes, ideas, or plans for this event..."
        rows={12}
        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl
                   bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100
                   focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none
                   placeholder:text-gray-400 dark:placeholder:text-gray-500"
      />
      <div className="flex items-center justify-between mt-2 text-xs text-gray-400 dark:text-gray-500">
        <div>
          {updatedBy && updatedAt && (
            <span>
              Last edited by{' '}
              <span className={updatedBy === 'daniel' ? 'text-blue-400' : 'text-rose-400'}>
                {updatedBy === 'daniel' ? 'Daniel' : 'Huaiyao'}
              </span>
              {', '}
              {formatTimeAgo(updatedAt)}
            </span>
          )}
        </div>
        <div>
          {saveStatus === 'saving' && <span className="text-amber-500">Saving...</span>}
          {saveStatus === 'saved' && <span className="text-green-500">Saved</span>}
        </div>
      </div>
    </div>
  );
}
