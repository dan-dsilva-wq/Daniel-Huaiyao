'use client';

import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface Place {
  id: string;
  name: string;
  country: string | null;
  location_key: string | null;
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

// TopoJSON sources
const worldGeoUrl = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const usGeoUrl = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

// US States list
const US_STATES: Record<string, string> = {
  'Alabama': 'US-AL', 'Alaska': 'US-AK', 'Arizona': 'US-AZ', 'Arkansas': 'US-AR',
  'California': 'US-CA', 'Colorado': 'US-CO', 'Connecticut': 'US-CT', 'Delaware': 'US-DE',
  'Florida': 'US-FL', 'Georgia': 'US-GA', 'Hawaii': 'US-HI', 'Idaho': 'US-ID',
  'Illinois': 'US-IL', 'Indiana': 'US-IN', 'Iowa': 'US-IA', 'Kansas': 'US-KS',
  'Kentucky': 'US-KY', 'Louisiana': 'US-LA', 'Maine': 'US-ME', 'Maryland': 'US-MD',
  'Massachusetts': 'US-MA', 'Michigan': 'US-MI', 'Minnesota': 'US-MN', 'Mississippi': 'US-MS',
  'Missouri': 'US-MO', 'Montana': 'US-MT', 'Nebraska': 'US-NE', 'Nevada': 'US-NV',
  'New Hampshire': 'US-NH', 'New Jersey': 'US-NJ', 'New Mexico': 'US-NM', 'New York': 'US-NY',
  'North Carolina': 'US-NC', 'North Dakota': 'US-ND', 'Ohio': 'US-OH', 'Oklahoma': 'US-OK',
  'Oregon': 'US-OR', 'Pennsylvania': 'US-PA', 'Rhode Island': 'US-RI', 'South Carolina': 'US-SC',
  'South Dakota': 'US-SD', 'Tennessee': 'US-TN', 'Texas': 'US-TX', 'Utah': 'US-UT',
  'Vermont': 'US-VT', 'Virginia': 'US-VA', 'Washington': 'US-WA', 'West Virginia': 'US-WV',
  'Wisconsin': 'US-WI', 'Wyoming': 'US-WY', 'District of Columbia': 'US-DC',
  'Puerto Rico': 'US-PR',
};

// Map countries to regions
const COUNTRY_TO_REGION: Record<string, string> = {
  // North America
  'United States of America': 'north-america', 'Canada': 'north-america', 'Mexico': 'north-america',
  'Guatemala': 'north-america', 'Cuba': 'north-america', 'Haiti': 'north-america',
  'Dominican Rep.': 'north-america', 'Honduras': 'north-america', 'Nicaragua': 'north-america',
  'El Salvador': 'north-america', 'Costa Rica': 'north-america', 'Panama': 'north-america',
  'Jamaica': 'north-america', 'Trinidad and Tobago': 'north-america', 'Belize': 'north-america',
  'Bahamas': 'north-america', 'Greenland': 'north-america',
  // South America
  'Brazil': 'south-america', 'Colombia': 'south-america', 'Argentina': 'south-america',
  'Peru': 'south-america', 'Venezuela': 'south-america', 'Chile': 'south-america',
  'Ecuador': 'south-america', 'Bolivia': 'south-america', 'Paraguay': 'south-america',
  'Uruguay': 'south-america', 'Guyana': 'south-america', 'Suriname': 'south-america',
  'French Guiana': 'south-america', 'Falkland Is.': 'south-america',
  // Europe
  'Russia': 'europe', 'Germany': 'europe', 'United Kingdom': 'europe', 'France': 'europe',
  'Italy': 'europe', 'Spain': 'europe', 'Ukraine': 'europe', 'Poland': 'europe',
  'Romania': 'europe', 'Netherlands': 'europe', 'Belgium': 'europe', 'Czech Rep.': 'europe',
  'Greece': 'europe', 'Portugal': 'europe', 'Sweden': 'europe', 'Hungary': 'europe',
  'Belarus': 'europe', 'Austria': 'europe', 'Serbia': 'europe', 'Switzerland': 'europe',
  'Bulgaria': 'europe', 'Denmark': 'europe', 'Finland': 'europe', 'Slovakia': 'europe',
  'Norway': 'europe', 'Ireland': 'europe', 'Croatia': 'europe', 'Moldova': 'europe',
  'Bosnia and Herz.': 'europe', 'Albania': 'europe', 'Lithuania': 'europe',
  'Macedonia': 'europe', 'Slovenia': 'europe', 'Latvia': 'europe', 'Estonia': 'europe',
  'Montenegro': 'europe', 'Luxembourg': 'europe', 'Malta': 'europe', 'Iceland': 'europe',
  'Kosovo': 'europe', 'Cyprus': 'europe',
  // Africa
  'Nigeria': 'africa', 'Ethiopia': 'africa', 'Egypt': 'africa', 'Dem. Rep. Congo': 'africa',
  'Tanzania': 'africa', 'South Africa': 'africa', 'Kenya': 'africa', 'Uganda': 'africa',
  'Algeria': 'africa', 'Sudan': 'africa', 'Morocco': 'africa', 'Angola': 'africa',
  'Mozambique': 'africa', 'Ghana': 'africa', 'Madagascar': 'africa', 'Cameroon': 'africa',
  "Côte d'Ivoire": 'africa', 'Niger': 'africa', 'Burkina Faso': 'africa', 'Mali': 'africa',
  'Malawi': 'africa', 'Zambia': 'africa', 'Senegal': 'africa', 'Chad': 'africa',
  'Somalia': 'africa', 'Zimbabwe': 'africa', 'Guinea': 'africa', 'Rwanda': 'africa',
  'Benin': 'africa', 'Burundi': 'africa', 'Tunisia': 'africa', 'S. Sudan': 'africa',
  'Togo': 'africa', 'Sierra Leone': 'africa', 'Libya': 'africa', 'Central African Rep.': 'africa',
  'Mauritania': 'africa', 'Eritrea': 'africa', 'Namibia': 'africa', 'Gambia': 'africa',
  'Botswana': 'africa', 'Gabon': 'africa', 'Lesotho': 'africa', 'Guinea-Bissau': 'africa',
  'Eq. Guinea': 'africa', 'Mauritius': 'africa', 'eSwatini': 'africa', 'Djibouti': 'africa',
  'Comoros': 'africa', 'W. Sahara': 'africa', 'Congo': 'africa', 'Liberia': 'africa',
  // Asia
  'China': 'asia', 'India': 'asia', 'Indonesia': 'asia', 'Pakistan': 'asia',
  'Bangladesh': 'asia', 'Japan': 'asia', 'Philippines': 'asia', 'Vietnam': 'asia',
  'Turkey': 'asia', 'Iran': 'asia', 'Thailand': 'asia', 'Myanmar': 'asia',
  'South Korea': 'asia', 'Iraq': 'asia', 'Afghanistan': 'asia', 'Saudi Arabia': 'asia',
  'Uzbekistan': 'asia', 'Malaysia': 'asia', 'Yemen': 'asia', 'Nepal': 'asia',
  'North Korea': 'asia', 'Sri Lanka': 'asia', 'Kazakhstan': 'asia', 'Syria': 'asia',
  'Cambodia': 'asia', 'Jordan': 'asia', 'Azerbaijan': 'asia', 'United Arab Emirates': 'asia',
  'Tajikistan': 'asia', 'Israel': 'asia', 'Laos': 'asia', 'Lebanon': 'asia',
  'Kyrgyzstan': 'asia', 'Turkmenistan': 'asia', 'Singapore': 'asia', 'Oman': 'asia',
  'Palestine': 'asia', 'Kuwait': 'asia', 'Georgia': 'asia', 'Mongolia': 'asia',
  'Armenia': 'asia', 'Qatar': 'asia', 'Bahrain': 'asia', 'Timor-Leste': 'asia',
  'Bhutan': 'asia', 'Brunei': 'asia', 'Taiwan': 'asia',
  // Oceania
  'Australia': 'oceania', 'Papua New Guinea': 'oceania', 'New Zealand': 'oceania',
  'Fiji': 'oceania', 'Solomon Is.': 'oceania', 'Vanuatu': 'oceania', 'New Caledonia': 'oceania',
};

// Region zoom configurations
const REGION_ZOOM: Record<string, { center: [number, number]; scale: number }> = {
  'north-america': { center: [-100, 45], scale: 300 },
  'south-america': { center: [-60, -20], scale: 300 },
  'europe': { center: [15, 54], scale: 500 },
  'africa': { center: [20, 0], scale: 280 },
  'asia': { center: [100, 35], scale: 250 },
  'oceania': { center: [140, -25], scale: 350 },
};

// Region colors
const REGION_COLORS: Record<string, { default: string; visited: string; wishlist: string; hover: string }> = {
  'north-america': { default: '#38bdf8', visited: '#0369a1', wishlist: '#7dd3fc', hover: '#0ea5e9' },
  'south-america': { default: '#34d399', visited: '#047857', wishlist: '#6ee7b7', hover: '#10b981' },
  'europe': { default: '#a78bfa', visited: '#6d28d9', wishlist: '#c4b5fd', hover: '#8b5cf6' },
  'africa': { default: '#fbbf24', visited: '#b45309', wishlist: '#fcd34d', hover: '#f59e0b' },
  'asia': { default: '#fb7185', visited: '#be123c', wishlist: '#fda4af', hover: '#f43f5e' },
  'oceania': { default: '#60a5fa', visited: '#1d4ed8', wishlist: '#93c5fd', hover: '#3b82f6' },
};

const DEFAULT_COLOR = { default: '#e5e7eb', visited: '#6b7280', wishlist: '#d1d5db', hover: '#9ca3af' };

export default function MapPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [zoomedRegion, setZoomedRegion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [clickedLocation, setClickedLocation] = useState<{ name: string; key: string; isState: boolean } | null>(null);

  // Get all places as a map for quick lookup
  const placesByLocation = useMemo(() => {
    const map = new Map<string, Place>();
    regions.forEach(region => {
      region.places.forEach(place => {
        if (place.location_key) {
          map.set(place.location_key, place);
        }
        if (place.country) {
          map.set(place.country, place);
        }
      });
    });
    return map;
  }, [regions]);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_map_data');
      if (error) throw error;
      if (data) setRegions(data as Region[]);
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

  const addPlace = async (name: string, locationKey: string, isState: boolean, status: 'wishlist' | 'visited') => {
    const regionCode = isState ? 'north-america' : COUNTRY_TO_REGION[name];
    const region = regions.find(r => r.code === regionCode);

    if (!region) {
      alert(`Could not find region for ${name}. Make sure you've run the SQL schema in Supabase.`);
      return;
    }

    const country = isState ? 'United States' : name;

    const { error } = await supabase.rpc('add_map_place', {
      p_region_id: region.id,
      p_name: name,
      p_country: country,
      p_location_key: locationKey,
      p_status: status,
      p_added_by: currentUser,
      p_notes: null,
    });

    if (error) {
      console.error('Error adding place:', error);
      alert(`Error adding place: ${error.message}`);
      return;
    }

    sendNotification(status === 'visited' ? 'place_visited' : 'place_added', name);
    fetchData();
    setClickedLocation(null);
  };

  const markAsVisited = async (place: Place) => {
    const { error } = await supabase.rpc('toggle_map_place_status', {
      p_place_id: place.id,
    });

    if (error) {
      console.error('Error updating place:', error);
      return;
    }

    if (place.status === 'wishlist') {
      sendNotification('place_visited', place.name);
    }
    fetchData();
    setClickedLocation(null);
  };

  const removePlace = async (place: Place) => {
    const { error } = await supabase.rpc('delete_map_place', {
      p_place_id: place.id,
    });

    if (error) {
      console.error('Error removing place:', error);
      return;
    }

    fetchData();
    setClickedLocation(null);
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('map-user', user);
  };

  const handleLocationClick = (name: string, locationKey: string, isState: boolean) => {
    setClickedLocation({ name, key: locationKey, isState });
  };

  const getLocationStatus = (locationKey: string, name: string): 'none' | 'wishlist' | 'visited' => {
    const place = placesByLocation.get(locationKey) || placesByLocation.get(name);
    if (!place) return 'none';
    return place.status;
  };

  const getPlaceForLocation = (locationKey: string, name: string): Place | undefined => {
    return placesByLocation.get(locationKey) || placesByLocation.get(name);
  };

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
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity }} className="text-6xl mb-6">
            🗺️
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 mb-4">Who are you?</h1>
          <p className="text-gray-500 mb-8">So we know who to notify when you make changes</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => selectUser('daniel')}
              className="px-8 py-4 rounded-xl bg-blue-500 text-white font-medium shadow-lg hover:bg-blue-600 transition-colors">
              I'm Daniel
            </motion.button>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => selectUser('huaiyao')}
              className="px-8 py-4 rounded-xl bg-rose-500 text-white font-medium shadow-lg hover:bg-rose-600 transition-colors">
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
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-teal-200 border-t-teal-500 rounded-full" />
      </div>
    );
  }

  // Show US states when zoomed into North America
  const showUSStates = zoomedRegion === 'north-america';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-100/30 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-100/30 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-6 sm:py-12 pb-safe">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6 sm:mb-8">
          <a href="/" className="inline-block mb-4 px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 active:text-gray-800 transition-colors touch-manipulation">
            ← Home
          </a>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 mb-2">Our Travel Map</h1>
          <p className="text-gray-500">{totalWishlist} wishlist · {totalVisited} visited</p>
        </motion.div>

        {/* Back button when zoomed */}
        {zoomedRegion && (
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => setZoomedRegion(null)}
            className="mb-4 px-4 py-2 bg-white/80 backdrop-blur rounded-lg shadow-sm text-gray-600 hover:text-gray-800 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to World Map
          </motion.button>
        )}

        {/* Map Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white/70 backdrop-blur rounded-2xl shadow-lg p-4 sm:p-6 mb-6 overflow-hidden"
        >
          {showUSStates ? (
            // US States Map
            <ComposableMap
              projection="geoAlbersUsa"
              projectionConfig={{ scale: 800 }}
              style={{ width: '100%', height: 'auto' }}
            >
              <Geographies geography={usGeoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const stateName = geo.properties.name;
                    const stateCode = US_STATES[stateName];
                    const status = getLocationStatus(stateCode, stateName);
                    const colors = REGION_COLORS['north-america'];

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onClick={() => handleLocationClick(stateName, stateCode, true)}
                        style={{
                          default: {
                            fill: status === 'visited' ? colors.visited : status === 'wishlist' ? colors.wishlist : colors.default,
                            stroke: '#fff',
                            strokeWidth: 0.5,
                            outline: 'none',
                            cursor: 'pointer',
                          },
                          hover: {
                            fill: colors.hover,
                            stroke: '#fff',
                            strokeWidth: 0.75,
                            outline: 'none',
                            cursor: 'pointer',
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
            </ComposableMap>
          ) : zoomedRegion ? (
            // Zoomed region map
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{
                scale: REGION_ZOOM[zoomedRegion].scale,
                center: REGION_ZOOM[zoomedRegion].center,
              }}
              style={{ width: '100%', height: 'auto' }}
            >
              <Geographies geography={worldGeoUrl}>
                {({ geographies }) =>
                  geographies
                    .filter((geo) => COUNTRY_TO_REGION[geo.properties.name] === zoomedRegion)
                    .map((geo) => {
                      const countryName = geo.properties.name;
                      const status = getLocationStatus(countryName, countryName);
                      const colors = REGION_COLORS[zoomedRegion] || DEFAULT_COLOR;

                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          onClick={() => handleLocationClick(countryName, countryName, false)}
                          style={{
                            default: {
                              fill: status === 'visited' ? colors.visited : status === 'wishlist' ? colors.wishlist : colors.default,
                              stroke: '#fff',
                              strokeWidth: 0.5,
                              outline: 'none',
                              cursor: 'pointer',
                            },
                            hover: {
                              fill: colors.hover,
                              stroke: '#fff',
                              strokeWidth: 0.75,
                              outline: 'none',
                              cursor: 'pointer',
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
            </ComposableMap>
          ) : (
            // World overview map
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{ scale: 120, center: [0, 30] }}
              style={{ width: '100%', height: 'auto' }}
            >
              <Geographies geography={worldGeoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const countryName = geo.properties.name;
                    const regionCode = COUNTRY_TO_REGION[countryName];
                    const colors = regionCode ? REGION_COLORS[regionCode] : DEFAULT_COLOR;
                    const status = getLocationStatus(countryName, countryName);

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onClick={() => regionCode && setZoomedRegion(regionCode)}
                        style={{
                          default: {
                            fill: status === 'visited' ? colors.visited : status === 'wishlist' ? colors.wishlist : colors.default,
                            stroke: '#fff',
                            strokeWidth: 0.3,
                            outline: 'none',
                            cursor: regionCode ? 'pointer' : 'default',
                          },
                          hover: {
                            fill: regionCode ? colors.hover : colors.default,
                            stroke: '#fff',
                            strokeWidth: 0.5,
                            outline: 'none',
                            cursor: regionCode ? 'pointer' : 'default',
                          },
                          pressed: {
                            fill: colors.hover,
                            stroke: '#fff',
                            strokeWidth: 0.5,
                            outline: 'none',
                          },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
            </ComposableMap>
          )}

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-4 mt-4 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#38bdf8' }} />
              <span>Not visited</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#7dd3fc' }} />
              <span>Wishlist</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#0369a1' }} />
              <span>Visited</span>
            </div>
          </div>

          {/* Region buttons (only on world view) */}
          {!zoomedRegion && (
            <div className="flex flex-wrap justify-center gap-2 mt-4 text-xs sm:text-sm">
              {regions.map((region) => {
                const colors = REGION_COLORS[region.code];
                return (
                  <button
                    key={region.code}
                    onClick={() => setZoomedRegion(region.code)}
                    className="px-3 py-1.5 rounded-full transition-all hover:scale-105"
                    style={{ backgroundColor: colors?.default || '#e5e7eb' }}
                  >
                    <span className="text-white font-medium">{region.display_name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Instructions */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white/70 backdrop-blur rounded-xl shadow-sm p-4 mb-6">
          <p className="text-center text-gray-500 text-sm">
            {zoomedRegion
              ? 'Click a country or state to add it to your wishlist or mark as visited'
              : 'Click a region to zoom in, then click countries to add them'}
          </p>
        </motion.div>

        {/* Location Action Modal */}
        <AnimatePresence>
          {clickedLocation && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setClickedLocation(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-serif font-bold text-gray-800 mb-2">
                  {clickedLocation.name}
                </h3>
                {clickedLocation.isState && (
                  <p className="text-sm text-gray-500 mb-4">United States</p>
                )}

                {(() => {
                  const place = getPlaceForLocation(clickedLocation.key, clickedLocation.name);

                  if (!place) {
                    return (
                      <div className="space-y-3">
                        <button
                          onClick={() => addPlace(clickedLocation.name, clickedLocation.key, clickedLocation.isState, 'wishlist')}
                          className="w-full py-3 bg-teal-500 text-white rounded-xl font-medium hover:bg-teal-600 transition-colors"
                        >
                          Add to Wishlist
                        </button>
                        <button
                          onClick={() => addPlace(clickedLocation.name, clickedLocation.key, clickedLocation.isState, 'visited')}
                          className="w-full py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors"
                        >
                          Mark as Visited
                        </button>
                        <button
                          onClick={() => setClickedLocation(null)}
                          className="w-full py-2 text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      <div className={`text-sm px-3 py-2 rounded-lg ${
                        place.status === 'visited' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {place.status === 'visited' ? 'You have visited this place!' : 'On your wishlist'}
                        {place.added_by && (
                          <span className="ml-2 opacity-70">
                            (added by {place.added_by === 'daniel' ? 'Daniel' : 'Huaiyao'})
                          </span>
                        )}
                      </div>

                      {place.status === 'wishlist' && (
                        <button
                          onClick={() => markAsVisited(place)}
                          className="w-full py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors"
                        >
                          Mark as Visited
                        </button>
                      )}

                      {place.status === 'visited' && (
                        <button
                          onClick={() => markAsVisited(place)}
                          className="w-full py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-colors"
                        >
                          Move back to Wishlist
                        </button>
                      )}

                      <button
                        onClick={() => removePlace(place)}
                        className="w-full py-2 text-red-500 hover:text-red-700 transition-colors text-sm"
                      >
                        Remove from list
                      </button>

                      <button
                        onClick={() => setClickedLocation(null)}
                        className="w-full py-2 text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  );
                })()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 text-sm">
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
