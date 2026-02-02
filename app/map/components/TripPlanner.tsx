'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { supabase } from '@/lib/supabase';

interface TripPlace {
  id: string;
  place_id: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
  visit_order: number;
  planned_date: string | null;
  notes: string | null;
}

interface Trip {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: 'planning' | 'upcoming' | 'completed' | 'cancelled';
  created_by: string;
  created_at: string;
  places: TripPlace[];
  place_count: number;
}

interface TripPlannerProps {
  currentUser: 'daniel' | 'huaiyao';
  onClose: () => void;
  onSelectTrip?: (trip: Trip) => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  planning: { label: 'Planning', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', emoji: '📝' },
  upcoming: { label: 'Upcoming', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', emoji: '🗓️' },
  completed: { label: 'Completed', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', emoji: '✅' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', emoji: '❌' },
};

export function TripPlanner({ currentUser, onClose, onSelectTrip }: TripPlannerProps) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [showNewTrip, setShowNewTrip] = useState(false);

  // New trip form
  const [tripName, setTripName] = useState('');
  const [tripDescription, setTripDescription] = useState('');
  const [tripStartDate, setTripStartDate] = useState('');
  const [tripEndDate, setTripEndDate] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchTrips = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_trips');
      if (error) throw error;
      setTrips(data || []);
    } catch (error) {
      console.error('Error fetching trips:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripName.trim()) return;

    setCreating(true);
    try {
      const { error } = await supabase.rpc('create_trip', {
        p_name: tripName.trim(),
        p_description: tripDescription.trim() || null,
        p_start_date: tripStartDate || null,
        p_end_date: tripEndDate || null,
        p_created_by: currentUser,
      });

      if (error) throw error;

      // Reset form
      setTripName('');
      setTripDescription('');
      setTripStartDate('');
      setTripEndDate('');
      setShowNewTrip(false);
      fetchTrips();
    } catch (error) {
      console.error('Error creating trip:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateStatus = async (tripId: string, status: string) => {
    try {
      const { error } = await supabase.rpc('update_trip_status', {
        p_trip_id: tripId,
        p_status: status,
      });

      if (error) throw error;
      fetchTrips();
    } catch (error) {
      console.error('Error updating trip status:', error);
    }
  };

  const handleDeleteTrip = async (tripId: string) => {
    if (!confirm('Are you sure you want to delete this trip?')) return;

    try {
      const { error } = await supabase.rpc('delete_trip', { p_trip_id: tripId });
      if (error) throw error;
      setSelectedTrip(null);
      fetchTrips();
    } catch (error) {
      console.error('Error deleting trip:', error);
    }
  };

  const handleRemovePlace = async (tripPlaceId: string) => {
    try {
      const { error } = await supabase.rpc('remove_trip_place', {
        p_trip_place_id: tripPlaceId,
      });

      if (error) throw error;
      fetchTrips();

      // Update selected trip
      if (selectedTrip) {
        setSelectedTrip({
          ...selectedTrip,
          places: selectedTrip.places.filter((p) => p.id !== tripPlaceId),
        });
      }
    } catch (error) {
      console.error('Error removing place:', error);
    }
  };

  const handleReorderPlaces = async (tripId: string, reorderedPlaces: TripPlace[]) => {
    // Update local state immediately for smooth UX
    if (selectedTrip) {
      setSelectedTrip({ ...selectedTrip, places: reorderedPlaces });
    }

    try {
      const { error } = await supabase.rpc('reorder_trip_places', {
        p_trip_id: tripId,
        p_place_ids: reorderedPlaces.map((p) => p.id),
      });

      if (error) throw error;
    } catch (error) {
      console.error('Error reordering places:', error);
      fetchTrips(); // Revert on error
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
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
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {selectedTrip && (
              <button
                onClick={() => setSelectedTrip(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-xl font-bold dark:text-white">
              {selectedTrip ? selectedTrip.name : 'Trip Planner'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!selectedTrip && (
              <button
                onClick={() => setShowNewTrip(true)}
                className="px-3 py-1.5 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 transition-colors"
              >
                + New Trip
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full"
              />
            </div>
          ) : selectedTrip ? (
            // Trip Detail View
            <div className="space-y-4">
              {/* Trip Info */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                {selectedTrip.description && (
                  <p className="text-gray-600 dark:text-gray-300 mb-3">
                    {selectedTrip.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className={`px-2 py-1 rounded ${STATUS_CONFIG[selectedTrip.status].color}`}>
                    {STATUS_CONFIG[selectedTrip.status].emoji} {STATUS_CONFIG[selectedTrip.status].label}
                  </span>
                  {selectedTrip.start_date && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {formatDate(selectedTrip.start_date)}
                      {selectedTrip.end_date && ` - ${formatDate(selectedTrip.end_date)}`}
                    </span>
                  )}
                </div>

                {/* Status Change */}
                <div className="flex gap-2 mt-4">
                  {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                    <button
                      key={status}
                      onClick={() => handleUpdateStatus(selectedTrip.id, status)}
                      disabled={selectedTrip.status === status}
                      className={`px-2 py-1 rounded text-xs transition-colors ${
                        selectedTrip.status === status
                          ? config.color
                          : 'bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-500'
                      }`}
                    >
                      {config.emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Places */}
              <div>
                <h3 className="font-semibold dark:text-white mb-2">
                  Destinations ({selectedTrip.places.length})
                </h3>

                {selectedTrip.places.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <div className="text-3xl mb-2">📍</div>
                    <p>No destinations added yet</p>
                    <p className="text-sm mt-1">
                      Add places from the map to include them in this trip
                    </p>
                  </div>
                ) : (
                  <Reorder.Group
                    axis="y"
                    values={selectedTrip.places}
                    onReorder={(newOrder) => handleReorderPlaces(selectedTrip.id, newOrder)}
                    className="space-y-2"
                  >
                    {selectedTrip.places.map((place, index) => (
                      <Reorder.Item
                        key={place.id}
                        value={place}
                        className="bg-white dark:bg-gray-700 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-600 cursor-grab active:cursor-grabbing"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 flex items-center justify-center text-sm font-medium">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium dark:text-white truncate">
                              {place.name || 'Unknown Place'}
                            </div>
                            {place.planned_date && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {formatDate(place.planned_date)}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemovePlace(place.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        {place.notes && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 pl-9">
                            {place.notes}
                          </p>
                        )}
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                {onSelectTrip && selectedTrip.places.length > 0 && (
                  <button
                    onClick={() => {
                      onSelectTrip(selectedTrip);
                      onClose();
                    }}
                    className="flex-1 px-4 py-2 bg-teal-500 text-white rounded-lg font-medium hover:bg-teal-600 transition-colors"
                  >
                    View on Map
                  </button>
                )}
                <button
                  onClick={() => handleDeleteTrip(selectedTrip.id)}
                  className="px-4 py-2 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-lg font-medium hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                >
                  Delete Trip
                </button>
              </div>
            </div>
          ) : trips.length === 0 ? (
            // Empty State
            <div className="text-center py-12">
              <div className="text-5xl mb-4">✈️</div>
              <h3 className="text-xl font-semibold dark:text-white mb-2">No trips planned yet</h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Start planning your next adventure together!
              </p>
              <button
                onClick={() => setShowNewTrip(true)}
                className="px-6 py-2 bg-teal-500 text-white rounded-lg font-medium hover:bg-teal-600 transition-colors"
              >
                Plan a Trip
              </button>
            </div>
          ) : (
            // Trip List
            <div className="space-y-3">
              {trips.map((trip, index) => (
                <motion.div
                  key={trip.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setSelectedTrip(trip)}
                  className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold dark:text-white">{trip.name}</h3>
                      {trip.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1 mt-1">
                          {trip.description}
                        </p>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_CONFIG[trip.status].color}`}>
                      {STATUS_CONFIG[trip.status].emoji}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
                    <span>📍 {trip.place_count} places</span>
                    {trip.start_date && (
                      <span>🗓️ {formatDate(trip.start_date)}</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* New Trip Modal */}
        <AnimatePresence>
          {showNewTrip && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 flex items-center justify-center p-4"
              onClick={() => setShowNewTrip(false)}
            >
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md"
              >
                <h3 className="text-lg font-bold mb-4 dark:text-white">New Trip</h3>

                <form onSubmit={handleCreateTrip} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Trip Name
                    </label>
                    <input
                      type="text"
                      value={tripName}
                      onChange={(e) => setTripName(e.target.value)}
                      placeholder="e.g., Japan Adventure 2026"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Description (optional)
                    </label>
                    <textarea
                      value={tripDescription}
                      onChange={(e) => setTripDescription(e.target.value)}
                      placeholder="What's this trip about?"
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-700 dark:text-white resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={tripStartDate}
                        onChange={(e) => setTripStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={tripEndDate}
                        onChange={(e) => setTripEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowNewTrip(false)}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creating || !tripName.trim()}
                      className="flex-1 px-4 py-2 bg-teal-500 text-white rounded-lg font-medium disabled:opacity-50 hover:bg-teal-600 transition-colors"
                    >
                      {creating ? 'Creating...' : 'Create Trip'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
