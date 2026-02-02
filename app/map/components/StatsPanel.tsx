'use client';

import { motion } from 'framer-motion';

interface Place {
  id: string;
  name: string;
  country: string | null;
  location_key: string | null;
  status: 'wishlist' | 'visited';
  added_by: 'daniel' | 'huaiyao' | null;
}

interface Region {
  id: string;
  code: string;
  display_name: string;
  places: Place[];
}

interface StatsPanelProps {
  regions: Region[];
  onClose: () => void;
}

export default function StatsPanel({ regions, onClose }: StatsPanelProps) {
  // Calculate stats
  const allPlaces = regions.flatMap((r) => r.places);
  const visited = allPlaces.filter((p) => p.status === 'visited');
  const wishlist = allPlaces.filter((p) => p.status === 'wishlist');

  // Countries visited (exclude US states)
  const visitedCountries = new Set(
    visited.filter((p) => !p.location_key?.startsWith('US-')).map((p) => p.name)
  );
  const wishlistCountries = new Set(
    wishlist.filter((p) => !p.location_key?.startsWith('US-')).map((p) => p.name)
  );

  // US states
  const visitedStates = visited.filter((p) => p.location_key?.startsWith('US-'));
  const wishlistStates = wishlist.filter((p) => p.location_key?.startsWith('US-'));

  // By region
  const regionStats = regions.map((region) => ({
    name: region.display_name,
    code: region.code,
    visited: region.places.filter((p) => p.status === 'visited').length,
    wishlist: region.places.filter((p) => p.status === 'wishlist').length,
    total: region.places.length,
  }));

  // By person
  const danielVisited = visited.filter((p) => p.added_by === 'daniel').length;
  const huaiyaoVisited = visited.filter((p) => p.added_by === 'huaiyao').length;
  const danielWishlist = wishlist.filter((p) => p.added_by === 'daniel').length;
  const huaiyaoWishlist = wishlist.filter((p) => p.added_by === 'huaiyao').length;

  // Continents covered
  const visitedContinents = new Set(
    regions.filter((r) => r.places.some((p) => p.status === 'visited')).map((r) => r.code)
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-serif font-bold text-gray-800 dark:text-gray-100">
            Travel Stats
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">
              {visitedCountries.size + visitedStates.length}
            </div>
            <div className="text-sm text-green-700 dark:text-green-300">Places Visited</div>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {wishlistCountries.size + wishlistStates.length}
            </div>
            <div className="text-sm text-amber-700 dark:text-amber-300">On Wishlist</div>
          </div>
        </div>

        {/* Detailed stats */}
        <div className="space-y-4">
          {/* Countries */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-2">Countries</h3>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Visited:</span>
              <span className="text-green-600 dark:text-green-400 font-medium">{visitedCountries.size}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Wishlist:</span>
              <span className="text-amber-600 dark:text-amber-400 font-medium">{wishlistCountries.size}</span>
            </div>
          </div>

          {/* US States */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-2">US States</h3>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Visited:</span>
              <span className="text-green-600 dark:text-green-400 font-medium">{visitedStates.length}/50</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Wishlist:</span>
              <span className="text-amber-600 dark:text-amber-400 font-medium">{wishlistStates.length}</span>
            </div>
            {visitedStates.length > 0 && (
              <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500"
                  style={{ width: `${(visitedStates.length / 50) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Continents */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-2">Continents Visited</h3>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mb-1">
              {visitedContinents.size}/6
            </div>
            <div className="flex flex-wrap gap-1">
              {regions.map((r) => (
                <span
                  key={r.code}
                  className={`px-2 py-1 rounded-full text-xs ${
                    visitedContinents.has(r.code)
                      ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {r.display_name}
                </span>
              ))}
            </div>
          </div>

          {/* By Person */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-3">By Explorer</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Daniel</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {danielVisited} visited · {danielWishlist} wishlist
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-rose-600 dark:text-rose-400 mb-1">Huaiyao</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {huaiyaoVisited} visited · {huaiyaoWishlist} wishlist
                </div>
              </div>
            </div>
          </div>

          {/* By Region */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
            <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-3">By Region</h3>
            <div className="space-y-2">
              {regionStats.filter((r) => r.total > 0).map((region) => (
                <div key={region.code} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">{region.name}</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    <span className="text-green-600 dark:text-green-400">{region.visited}</span>
                    {' / '}
                    <span className="text-amber-600 dark:text-amber-400">{region.wishlist}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 py-3 bg-teal-500 text-white rounded-xl font-medium hover:bg-teal-600 transition-colors"
        >
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}
