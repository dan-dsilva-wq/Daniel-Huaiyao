'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';

interface HistoryNode {
  id: string;
  scene_id: string;
  scene_title: string;
  scene_type: string;
  choice_id: string | null;
  choice_text: string | null;
  scene_order: number;
  visited_at: string;
}

interface SessionHistory {
  session_id: string;
  history: HistoryNode[];
  total_scenes: number;
  unique_paths: number;
}

interface SceneVisit {
  scene_id: string;
  scene_title: string;
  scene_type: string;
  visit_count: number;
}

interface ChoiceStat {
  choice_id: string;
  choice_text: string;
  from_scene: string;
  to_scene: string;
  times_chosen: number;
}

interface EndingStat {
  ending_id: string;
  ending_title: string;
  ending_type: string;
  times_reached: number;
}

interface EpisodeStats {
  episode_id: string;
  total_sessions: number;
  completed_sessions: number;
  scene_visits: SceneVisit[];
  choice_stats: ChoiceStat[];
  ending_distribution: EndingStat[];
}

interface BranchVisualizationProps {
  sessionId?: string;
  episodeId?: string;
  onClose: () => void;
}

const SCENE_TYPE_CONFIG: Record<string, { emoji: string; color: string }> = {
  intro: { emoji: '📖', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  story: { emoji: '📜', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  choice: { emoji: '🔀', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  puzzle: { emoji: '🧩', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  ending: { emoji: '🎬', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

const ENDING_TYPE_CONFIG: Record<string, { emoji: string; label: string }> = {
  best: { emoji: '🏆', label: 'Best' },
  good: { emoji: '✨', label: 'Good' },
  neutral: { emoji: '😐', label: 'Neutral' },
  bad: { emoji: '💀', label: 'Bad' },
};

export function BranchVisualization({ sessionId, episodeId, onClose }: BranchVisualizationProps) {
  const [sessionHistory, setSessionHistory] = useState<SessionHistory | null>(null);
  const [episodeStats, setEpisodeStats] = useState<EpisodeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'path' | 'stats'>('path');

  const fetchData = useCallback(async () => {
    try {
      if (sessionId) {
        const { data, error } = await supabase.rpc('get_session_history', {
          p_session_id: sessionId,
        });
        if (error) throw error;
        setSessionHistory(data);
      }

      if (episodeId) {
        const { data, error } = await supabase.rpc('get_episode_branch_stats', {
          p_episode_id: episodeId,
        });
        if (error) throw error;
        setEpisodeStats(data);
      }
    } catch (error) {
      console.error('Error fetching branch data:', error);
    } finally {
      setLoading(false);
    }
  }, [sessionId, episodeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const maxVisits = episodeStats?.scene_visits
    ? Math.max(...episodeStats.scene_visits.map((s) => s.visit_count))
    : 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const maxChosen = episodeStats?.choice_stats
    ? Math.max(...episodeStats.choice_stats.map((c) => c.times_chosen))
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-900 to-slate-900 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Story Path</h2>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          {episodeStats && sessionHistory && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setActiveTab('path')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'path'
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                Your Path
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'stats'
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                Episode Stats
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full"
              />
            </div>
          ) : activeTab === 'path' && sessionHistory ? (
            // Session Path View
            <div>
              {/* Summary */}
              <div className="flex gap-4 mb-6">
                <div className="flex-1 bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                    {sessionHistory.total_scenes}
                  </div>
                  <div className="text-sm text-purple-600 dark:text-purple-400">Scenes Visited</div>
                </div>
                <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                    {sessionHistory.unique_paths}
                  </div>
                  <div className="text-sm text-blue-600 dark:text-blue-400">Unique Scenes</div>
                </div>
              </div>

              {/* Path Timeline */}
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-purple-200 dark:bg-purple-800" />

                {sessionHistory.history.map((node, index) => (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="relative mb-4 ml-10"
                  >
                    {/* Timeline dot */}
                    <div
                      className={`absolute -left-8 top-2 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 ${
                        node.scene_type === 'ending'
                          ? 'bg-green-500'
                          : node.scene_type === 'choice'
                          ? 'bg-purple-500'
                          : node.scene_type === 'puzzle'
                          ? 'bg-amber-500'
                          : 'bg-blue-500'
                      }`}
                    />

                    {/* Scene card */}
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">
                          {SCENE_TYPE_CONFIG[node.scene_type]?.emoji || '📄'}
                        </span>
                        <span className="font-medium dark:text-white">
                          {node.scene_title}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            SCENE_TYPE_CONFIG[node.scene_type]?.color || 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {node.scene_type}
                        </span>
                      </div>

                      {node.choice_text && (
                        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 pl-7">
                          <span className="text-purple-500 dark:text-purple-400">Choice:</span>{' '}
                          &quot;{node.choice_text}&quot;
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ) : episodeStats ? (
            // Episode Stats View
            <div className="space-y-6">
              {/* Overview */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-purple-700 dark:text-purple-300">
                    {episodeStats.total_sessions}
                  </div>
                  <div className="text-sm text-purple-600 dark:text-purple-400">Total Plays</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-green-700 dark:text-green-300">
                    {episodeStats.completed_sessions}
                  </div>
                  <div className="text-sm text-green-600 dark:text-green-400">Completed</div>
                </div>
              </div>

              {/* Ending Distribution */}
              {episodeStats.ending_distribution.length > 0 && (
                <div>
                  <h3 className="font-semibold dark:text-white mb-3">Endings Reached</h3>
                  <div className="space-y-2">
                    {episodeStats.ending_distribution.map((ending) => (
                      <div
                        key={ending.ending_id}
                        className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="flex items-center gap-2 dark:text-white">
                            <span>{ENDING_TYPE_CONFIG[ending.ending_type]?.emoji || '🎬'}</span>
                            {ending.ending_title}
                          </span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {ending.times_reached}x
                          </span>
                        </div>
                        <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{
                              width: `${
                                (ending.times_reached / episodeStats.completed_sessions) * 100
                              }%`,
                            }}
                            className={`h-full ${
                              ending.ending_type === 'best'
                                ? 'bg-yellow-500'
                                : ending.ending_type === 'good'
                                ? 'bg-green-500'
                                : ending.ending_type === 'neutral'
                                ? 'bg-blue-500'
                                : 'bg-red-500'
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Most Visited Scenes */}
              {episodeStats.scene_visits.length > 0 && (
                <div>
                  <h3 className="font-semibold dark:text-white mb-3">Most Visited Scenes</h3>
                  <div className="space-y-2">
                    {episodeStats.scene_visits.slice(0, 5).map((scene) => (
                      <div
                        key={scene.scene_id}
                        className="flex items-center gap-3"
                      >
                        <span>{SCENE_TYPE_CONFIG[scene.scene_type]?.emoji || '📄'}</span>
                        <div className="flex-1">
                          <div className="text-sm dark:text-white truncate">
                            {scene.scene_title}
                          </div>
                          <div className="h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(scene.visit_count / maxVisits) * 100}%` }}
                              className="h-full bg-purple-500"
                            />
                          </div>
                        </div>
                        <span className="text-sm text-gray-500 dark:text-gray-400 w-8 text-right">
                          {scene.visit_count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Popular Choices */}
              {episodeStats.choice_stats.filter((c) => c.times_chosen > 0).length > 0 && (
                <div>
                  <h3 className="font-semibold dark:text-white mb-3">Popular Choices</h3>
                  <div className="space-y-2">
                    {episodeStats.choice_stats
                      .filter((c) => c.times_chosen > 0)
                      .slice(0, 5)
                      .map((choice) => (
                        <div
                          key={choice.choice_id}
                          className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3"
                        >
                          <div className="text-sm dark:text-white mb-1">
                            &quot;{choice.choice_text}&quot;
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>
                              {choice.from_scene} → {choice.to_scene}
                            </span>
                            <span>{choice.times_chosen}x chosen</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              No data available
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
