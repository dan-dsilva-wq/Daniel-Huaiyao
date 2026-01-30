'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface Place {
  id: string;
  name: string;
  country: string | null;
  status: 'wishlist' | 'visited';
  added_by: 'daniel' | 'huaiyao' | null;
  notes: string | null;
  visit_date: string | null;
  created_at: string;
}

interface Region {
  id: string;
  code: string;
  display_name: string;
  color_from: string;
  color_to: string;
  places: Place[];
}

// TopoJSON world map
const geoUrl = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

// Map countries to regions by continent
const COUNTRY_TO_REGION: Record<string, string> = {
  // North America
  'United States of America': 'north-america',
  'Canada': 'north-america',
  'Mexico': 'north-america',
  'Guatemala': 'north-america',
  'Cuba': 'north-america',
  'Haiti': 'north-america',
  'Dominican Rep.': 'north-america',
  'Honduras': 'north-america',
  'Nicaragua': 'north-america',
  'El Salvador': 'north-america',
  'Costa Rica': 'north-america',
  'Panama': 'north-america',
  'Jamaica': 'north-america',
  'Trinidad and Tobago': 'north-america',
  'Belize': 'north-america',
  'Bahamas': 'north-america',
  'Greenland': 'north-america',
  'Puerto Rico': 'north-america',

  // South America
  'Brazil': 'south-america',
  'Colombia': 'south-america',
  'Argentina': 'south-america',
  'Peru': 'south-america',
  'Venezuela': 'south-america',
  'Chile': 'south-america',
  'Ecuador': 'south-america',
  'Bolivia': 'south-america',
  'Paraguay': 'south-america',
  'Uruguay': 'south-america',
  'Guyana': 'south-america',
  'Suriname': 'south-america',
  'French Guiana': 'south-america',
  'Falkland Is.': 'south-america',

  // Europe
  'Russia': 'europe',
  'Germany': 'europe',
  'United Kingdom': 'europe',
  'France': 'europe',
  'Italy': 'europe',
  'Spain': 'europe',
  'Ukraine': 'europe',
  'Poland': 'europe',
  'Romania': 'europe',
  'Netherlands': 'europe',
  'Belgium': 'europe',
  'Czech Rep.': 'europe',
  'Greece': 'europe',
  'Portugal': 'europe',
  'Sweden': 'europe',
  'Hungary': 'europe',
  'Belarus': 'europe',
  'Austria': 'europe',
  'Serbia': 'europe',
  'Switzerland': 'europe',
  'Bulgaria': 'europe',
  'Denmark': 'europe',
  'Finland': 'europe',
  'Slovakia': 'europe',
  'Norway': 'europe',
  'Ireland': 'europe',
  'Croatia': 'europe',
  'Moldova': 'europe',
  'Bosnia and Herz.': 'europe',
  'Albania': 'europe',
  'Lithuania': 'europe',
  'Macedonia': 'europe',
  'Slovenia': 'europe',
  'Latvia': 'europe',
  'Estonia': 'europe',
  'Montenegro': 'europe',
  'Luxembourg': 'europe',
  'Malta': 'europe',
  'Iceland': 'europe',
  'Kosovo': 'europe',
  'Cyprus': 'europe',

  // Africa
  'Nigeria': 'africa',
  'Ethiopia': 'africa',
  'Egypt': 'africa',
  'Dem. Rep. Congo': 'africa',
  'Tanzania': 'africa',
  'South Africa': 'africa',
  'Kenya': 'africa',
  'Uganda': 'africa',
  'Algeria': 'africa',
  'Sudan': 'africa',
  'Morocco': 'africa',
  'Angola': 'africa',
  'Mozambique': 'africa',
  'Ghana': 'africa',
  'Madagascar': 'africa',
  'Cameroon': 'africa',
  "Côte d'Ivoire": 'africa',
  'Niger': 'africa',
  'Burkina Faso': 'africa',
  'Mali': 'africa',
  'Malawi': 'africa',
  'Zambia': 'africa',
  'Senegal': 'africa',
  'Chad': 'africa',
  'Somalia': 'africa',
  'Zimbabwe': 'africa',
  'Guinea': 'africa',
  'Rwanda': 'africa',
  'Benin': 'africa',
  'Burundi': 'africa',
  'Tunisia': 'africa',
  'S. Sudan': 'africa',
  'Togo': 'africa',
  'Sierra Leone': 'africa',
  'Libya': 'africa',
  'Central African Rep.': 'africa',
  'Mauritania': 'africa',
  'Eritrea': 'africa',
  'Namibia': 'africa',
  'Gambia': 'africa',
  'Botswana': 'africa',
  'Gabon': 'africa',
  'Lesotho': 'africa',
  'Guinea-Bissau': 'africa',
  'Eq. Guinea': 'africa',
  'Mauritius': 'africa',
  'eSwatini': 'africa',
  'Djibouti': 'africa',
  'Réunion': 'africa',
  'Comoros': 'africa',
  'W. Sahara': 'africa',
  'Congo': 'africa',
  'Liberia': 'africa',

  // Asia
  'China': 'asia',
  'India': 'asia',
  'Indonesia': 'asia',
  'Pakistan': 'asia',
  'Bangladesh': 'asia',
  'Japan': 'asia',
  'Philippines': 'asia',
  'Vietnam': 'asia',
  'Turkey': 'asia',
  'Iran': 'asia',
  'Thailand': 'asia',
  'Myanmar': 'asia',
  'South Korea': 'asia',
  'Iraq': 'asia',
  'Afghanistan': 'asia',
  'Saudi Arabia': 'asia',
  'Uzbekistan': 'asia',
  'Malaysia': 'asia',
  'Yemen': 'asia',
  'Nepal': 'asia',
  'North Korea': 'asia',
  'Sri Lanka': 'asia',
  'Kazakhstan': 'asia',
  'Syria': 'asia',
  'Cambodia': 'asia',
  'Jordan': 'asia',
  'Azerbaijan': 'asia',
  'United Arab Emirates': 'asia',
  'Tajikistan': 'asia',
  'Israel': 'asia',
  'Laos': 'asia',
  'Lebanon': 'asia',
  'Kyrgyzstan': 'asia',
  'Turkmenistan': 'asia',
  'Singapore': 'asia',
  'Oman': 'asia',
  'Palestine': 'asia',
  'Kuwait': 'asia',
  'Georgia': 'asia',
  'Mongolia': 'asia',
  'Armenia': 'asia',
  'Qatar': 'asia',
  'Bahrain': 'asia',
  'Timor-Leste': 'asia',
  'Bhutan': 'asia',
  'Brunei': 'asia',
  'Taiwan': 'asia',

  // Oceania
  'Australia': 'oceania',
  'Papua New Guinea': 'oceania',
  'New Zealand': 'oceania',
  'Fiji': 'oceania',
  'Solomon Is.': 'oceania',
  'Vanuatu': 'oceania',
  'New Caledonia': 'oceania',
  'Samoa': 'oceania',
};

// Region colors for the map
const REGION_COLORS: Record<string, { fill: string; hover: string }> = {
  'north-america': { fill: '#38bdf8', hover: '#0ea5e9' },
  'south-america': { fill: '#34d399', hover: '#10b981' },
  'europe': { fill: '#a78bfa', hover: '#8b5cf6' },
  'africa': { fill: '#fbbf24', hover: '#f59e0b' },
  'asia': { fill: '#fb7185', hover: '#f43f5e' },
  'oceania': { fill: '#60a5fa', hover: '#3b82f6' },
};

const DEFAULT_COLOR = { fill: '#e5e7eb', hover: '#d1d5db' };

// Memoized map component for performance
const WorldMap = memo(function WorldMap({
  regions,
  selectedRegion,
  hoveredRegion,
  onRegionHover,
  onRegionClick,
}: {
  regions: Region[];
  selectedRegion: Region | null;
  hoveredRegion: string | null;
  onRegionHover: (code: string | null) => void;
  onRegionClick: (code: string) => void;
}) {
  return (
    <ComposableMap
      projection="geoMercator"
      projectionConfig={{
        scale: 120,
        center: [0, 30],
      }}
      style={{ width: '100%', height: 'auto' }}
    >
      <ZoomableGroup zoom={1} minZoom={1} maxZoom={1}>
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const countryName = geo.properties.name;
              const regionCode = COUNTRY_TO_REGION[countryName];
              const colors = regionCode ? REGION_COLORS[regionCode] : DEFAULT_COLOR;
              const isHovered = hoveredRegion === regionCode;
              const isSelected = selectedRegion?.code === regionCode;

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onMouseEnter={() => regionCode && onRegionHover(regionCode)}
                  onMouseLeave={() => onRegionHover(null)}
                  onClick={() => regionCode && onRegionClick(regionCode)}
                  style={{
                    default: {
                      fill: isSelected ? colors.hover : colors.fill,
                      stroke: '#fff',
                      strokeWidth: 0.5,
                      outline: 'none',
                      cursor: regionCode ? 'pointer' : 'default',
                    },
                    hover: {
                      fill: colors.hover,
                      stroke: '#fff',
                      strokeWidth: 0.75,
                      outline: 'none',
                      cursor: regionCode ? 'pointer' : 'default',
                    },
                    pressed: {
                      fill: colors.hover,
                      stroke: '#fff',
                      strokeWidth: 0.75,
                      outline: 'none',
                    },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ZoomableGroup>
    </ComposableMap>
  );
});

export default function MapPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  // Form state for adding places
  const [newPlaceName, setNewPlaceName] = useState('');
  const [newPlaceCountry, setNewPlaceCountry] = useState('');
  const [newPlaceNotes, setNewPlaceNotes] = useState('');
  const [addingToRegion, setAddingToRegion] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_map_data');

      if (error) {
        console.error('RPC error:', error);
        throw error;
      }

      if (data) {
        setRegions(data as Region[]);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('map-user') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);
    fetchData();
  }, [fetchData]);

  const sendNotification = async (action: 'place_added' | 'place_visited', title: string) => {
    if (!currentUser) return;

    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, title, user: currentUser }),
      });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  const addPlace = async () => {
    if (!newPlaceName.trim() || !addingToRegion) return;

    const { error } = await supabase.rpc('add_map_place', {
      p_region_id: addingToRegion,
      p_name: newPlaceName.trim(),
      p_country: newPlaceCountry.trim() || null,
      p_status: 'wishlist',
      p_added_by: currentUser,
      p_notes: newPlaceNotes.trim() || null,
    });

    if (error) {
      console.error('Error adding place:', error);
      return;
    }

    sendNotification('place_added', newPlaceName.trim());
    setNewPlaceName('');
    setNewPlaceCountry('');
    setNewPlaceNotes('');
    setShowAddModal(false);
    setAddingToRegion(null);
    fetchData();
  };

  const togglePlaceStatus = async (place: Place) => {
    const { data, error } = await supabase.rpc('toggle_map_place_status', {
      p_place_id: place.id,
    });

    if (error) {
      console.error('Error toggling status:', error);
      return;
    }

    if (data?.status === 'visited') {
      sendNotification('place_visited', place.name);
    }
    fetchData();
  };

  const deletePlace = async (place: Place) => {
    const { error } = await supabase.rpc('delete_map_place', {
      p_place_id: place.id,
    });

    if (error) {
      console.error('Error deleting place:', error);
      return;
    }

    fetchData();
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('map-user', user);
  };

  const handleRegionClick = (regionCode: string) => {
    const region = regions.find((r) => r.code === regionCode);
    if (region) {
      setSelectedRegion(region);
    }
  };

  // Update selected region when data changes
  useEffect(() => {
    if (selectedRegion) {
      const updated = regions.find((r) => r.code === selectedRegion.code);
      if (updated) {
        setSelectedRegion(updated);
      }
    }
  }, [regions, selectedRegion]);

  const totalWishlist = regions.reduce((sum, r) => sum + r.places.filter(p => p.status === 'wishlist').length, 0);
  const totalVisited = regions.reduce((sum, r) => sum + r.places.filter(p => p.status === 'visited').length, 0);

  // User selection screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="text-6xl mb-6"
          >
            🗺️
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 mb-4">
            Who are you?
          </h1>
          <p className="text-gray-500 mb-8">
            So we know who to notify when you make changes
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('daniel')}
              className="px-8 py-4 rounded-xl bg-blue-500 text-white font-medium shadow-lg hover:bg-blue-600 transition-colors"
            >
              I'm Daniel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('huaiyao')}
              className="px-8 py-4 rounded-xl bg-rose-500 text-white font-medium shadow-lg hover:bg-rose-600 transition-colors"
            >
              I'm Huaiyao
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-teal-200 border-t-teal-500 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-100/30 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-100/30 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-6 sm:py-12 pb-safe">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6 sm:mb-8"
        >
          <a
            href="/"
            className="inline-block mb-4 px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 active:text-gray-800 transition-colors touch-manipulation"
          >
            ← Home
          </a>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 mb-2">
            Our Travel Map
          </h1>
          <p className="text-gray-500">
            {totalWishlist} wishlist · {totalVisited} visited
          </p>
        </motion.div>

        {/* World Map */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white/70 backdrop-blur rounded-2xl shadow-lg p-4 sm:p-6 mb-6 overflow-hidden"
        >
          <WorldMap
            regions={regions}
            selectedRegion={selectedRegion}
            hoveredRegion={hoveredRegion}
            onRegionHover={setHoveredRegion}
            onRegionClick={handleRegionClick}
          />

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-2 mt-4 text-xs sm:text-sm">
            {regions.map((region) => {
              const colors = REGION_COLORS[region.code];
              const placeCount = region.places.length;
              return (
                <button
                  key={region.code}
                  onClick={() => setSelectedRegion(region)}
                  className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-2 ${
                    selectedRegion?.code === region.code
                      ? 'ring-2 ring-offset-2 ring-gray-400'
                      : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: colors?.fill || '#e5e7eb' }}
                >
                  <span className="text-white font-medium">{region.display_name}</span>
                  {placeCount > 0 && (
                    <span className="bg-white/30 text-white text-xs px-1.5 py-0.5 rounded-full">
                      {placeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Region Panel */}
        <AnimatePresence>
          {selectedRegion && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="rounded-2xl shadow-lg p-4 sm:p-6 mb-6"
              style={{
                background: `linear-gradient(135deg, ${REGION_COLORS[selectedRegion.code]?.fill || '#e5e7eb'}, ${REGION_COLORS[selectedRegion.code]?.hover || '#d1d5db'})`,
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl sm:text-2xl font-serif font-bold text-white">
                  {selectedRegion.display_name}
                </h2>
                <button
                  onClick={() => setSelectedRegion(null)}
                  className="p-2 text-white/70 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Places list */}
              <div className="space-y-2 mb-4">
                {selectedRegion.places.length === 0 ? (
                  <p className="text-white/70 text-center py-4">No places added yet</p>
                ) : (
                  selectedRegion.places.map((place) => (
                    <motion.div
                      key={place.id}
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="group flex items-center gap-3 bg-white/20 backdrop-blur rounded-lg p-3"
                    >
                      {/* Status indicator */}
                      <button
                        onClick={() => togglePlaceStatus(place)}
                        className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          place.status === 'visited'
                            ? 'bg-white border-white text-green-600'
                            : 'border-white/70 hover:border-white'
                        }`}
                      >
                        {place.status === 'visited' && (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>

                      {/* Place info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-white ${place.status === 'visited' ? 'line-through opacity-70' : ''}`}>
                            {place.name}
                          </span>
                          {place.added_by && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              place.added_by === 'daniel' ? 'bg-blue-500/50' : 'bg-rose-500/50'
                            } text-white/90`}>
                              {place.added_by === 'daniel' ? 'D' : 'H'}
                            </span>
                          )}
                        </div>
                        {place.country && (
                          <div className="text-sm text-white/70">{place.country}</div>
                        )}
                        {place.notes && (
                          <div className="text-sm text-white/60 mt-1">{place.notes}</div>
                        )}
                        {place.visit_date && (
                          <div className="text-xs text-white/50 mt-1">
                            Visited: {new Date(place.visit_date).toLocaleDateString()}
                          </div>
                        )}
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={() => deletePlace(place)}
                        className="opacity-0 group-hover:opacity-100 p-2 text-white/50 hover:text-white transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Add place button */}
              <button
                onClick={() => {
                  setAddingToRegion(selectedRegion.id);
                  setShowAddModal(true);
                }}
                className="w-full py-2 text-sm text-white/80 hover:text-white border border-dashed border-white/40 hover:border-white/70 rounded-lg transition-colors"
              >
                + Add place to {selectedRegion.display_name}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick add section when no region selected */}
        {!selectedRegion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white/70 backdrop-blur rounded-xl shadow-sm p-4 mb-6"
          >
            <p className="text-center text-gray-500 mb-3">
              Click a region on the map to see places or add new ones
            </p>
          </motion.div>
        )}

        {/* Add Place Modal */}
        <AnimatePresence>
          {showAddModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => {
                setShowAddModal(false);
                setAddingToRegion(null);
              }}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-serif font-bold text-gray-800 mb-4">
                  Add New Place
                </h3>

                {/* Region selector if not pre-selected */}
                {!addingToRegion && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Region
                    </label>
                    <select
                      value={addingToRegion || ''}
                      onChange={(e) => setAddingToRegion(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300"
                    >
                      <option value="">Select a region</option>
                      {regions.map((region) => (
                        <option key={region.id} value={region.id}>
                          {region.display_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Place Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Tokyo, Grand Canyon"
                      value={newPlaceName}
                      onChange={(e) => setNewPlaceName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Country (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Japan"
                      value={newPlaceCountry}
                      onChange={(e) => setNewPlaceCountry(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Notes (optional)
                    </label>
                    <textarea
                      placeholder="Why do you want to go here?"
                      value={newPlaceNotes}
                      onChange={(e) => setNewPlaceNotes(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => {
                      setShowAddModal(false);
                      setAddingToRegion(null);
                      setNewPlaceName('');
                      setNewPlaceCountry('');
                      setNewPlaceNotes('');
                    }}
                    className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addPlace}
                    disabled={!newPlaceName.trim() || !addingToRegion}
                    className="flex-1 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add Place
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 text-sm"
        >
          <p>Click a region · Tap to mark visited</p>
          <p className="mt-2">
            Logged in as{' '}
            <span className={currentUser === 'daniel' ? 'text-blue-500' : 'text-rose-500'}>
              {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </span>
            {' · '}
            <button
              onClick={() => {
                localStorage.removeItem('map-user');
                setCurrentUser(null);
              }}
              className="underline hover:text-gray-600"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}
