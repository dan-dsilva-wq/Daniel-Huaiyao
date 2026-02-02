'use client';

import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ComposableMap, Geographies, Geography, ZoomableGroup, Marker } from 'react-simple-maps';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import StatsPanel from './components/StatsPanel';
import { PhotoGallery } from './components/PhotoGallery';
import { TripPlanner } from './components/TripPlanner';
import { ThemeToggle } from '../components/ThemeToggle';
import dynamic from 'next/dynamic';

// Dynamically import Leaflet to avoid SSR issues
const LeafletMap = dynamic(() => import('./components/LeafletMap'), { ssr: false });

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
  // Dual status fields
  daniel_status: 'wishlist' | 'visited' | null;
  daniel_visit_date: string | null;
  huaiyao_status: 'wishlist' | 'visited' | null;
  huaiyao_visit_date: string | null;
}

interface MemoryLocation {
  id: string;
  title: string;
  location_name: string;
  location_lat: number;
  location_lng: number;
  memory_date: string;
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
  useMarkAppViewed('map');
  const [regions, setRegions] = useState<Region[]>([]);
  const [zoomedRegion, setZoomedRegion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [clickedLocation, setClickedLocation] = useState<{ name: string; key: string; isState: boolean } | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showTripPlanner, setShowTripPlanner] = useState(false);
  const [photoGalleryPlace, setPhotoGalleryPlace] = useState<{ id: string; name: string } | null>(null);
  const [memoryLocations, setMemoryLocations] = useState<MemoryLocation[]>([]);
  const [showMemories, setShowMemories] = useState(true);
  const [showUSStates, setShowUSStates] = useState(false);
  const [showDetailedMap, setShowDetailedMap] = useState(false);

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
      // Try RPC first, fall back to direct query
      let mapData: Region[] | null = null;

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_map_data');
      if (!rpcError && rpcData) {
        mapData = rpcData as Region[];
      } else {
        console.warn('RPC failed, falling back to direct query:', rpcError);
        // Fallback: fetch directly from tables
        const { data: regionsData } = await supabase
          .from('map_regions')
          .select('id, code, display_name, color_from, color_to')
          .order('display_name');

        if (regionsData) {
          const regionsWithPlaces = await Promise.all(
            regionsData.map(async (region) => {
              const { data: places } = await supabase
                .from('map_places')
                .select('*')
                .eq('region_id', region.id);
              return {
                ...region,
                places: (places || []) as Place[],
              };
            })
          );
          mapData = regionsWithPlaces as Region[];
        }
      }

      if (mapData) setRegions(mapData);

      // Fetch memories with coordinates (for map markers)
      const { data: memories, error: memoriesError } = await supabase
        .from('memories')
        .select('id, title, location_name, location_lat, location_lng, memory_date')
        .not('location_lat', 'is', null)
        .not('location_lng', 'is', null)
        .order('memory_date', { ascending: false });

      if (!memoriesError && memories) {
        setMemoryLocations(memories.filter(m => m.location_lat && m.location_lng) as MemoryLocation[]);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
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

  const addPlace = async (name: string, locationKey: string, isState: boolean, status: 'wishlist' | 'visited', player?: 'daniel' | 'huaiyao') => {
    const regionCode = isState ? 'north-america' : COUNTRY_TO_REGION[name];
    const region = regions.find(r => r.code === regionCode);
    const addedBy = player || currentUser;

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
      p_added_by: addedBy,
      p_notes: null,
    });

    if (error) {
      console.error('Error adding place:', error);
      alert(`Error adding place: ${error.message}`);
      return;
    }

    sendNotification(status === 'visited' ? 'place_visited' : 'place_added', name);
    fetchData();
  };

  const clearPlaceStatus = async (placeId: string | undefined, player: 'daniel' | 'huaiyao') => {
    if (!placeId) return;

    const { error } = await supabase.rpc('clear_place_status', {
      p_place_id: placeId,
      p_player: player,
    });

    if (error) {
      console.error('Error clearing status:', error);
      return;
    }

    fetchData();
  };

  const markAsVisited = async (place: Place) => {
    const { error } = await supabase.rpc('toggle_map_place_status', {
      p_place_id: place.id,
      p_player: currentUser,
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
    localStorage.setItem('currentUser', user);
  };

  const handleLocationClick = (name: string, locationKey: string, isState: boolean) => {
    setClickedLocation({ name, key: locationKey, isState });
  };

  const getPlaceForLocation = (locationKey: string, name: string): Place | undefined => {
    return placesByLocation.get(locationKey) || placesByLocation.get(name);
  };

  // Dual status helper - returns status summary for both users
  const getDualStatus = (place: Place | undefined): {
    danielStatus: 'wishlist' | 'visited' | null;
    huaiyaoStatus: 'wishlist' | 'visited' | null;
    bothWantToGo: boolean;
    bothVisited: boolean;
    anyMarked: boolean;
  } => {
    if (!place) {
      return { danielStatus: null, huaiyaoStatus: null, bothWantToGo: false, bothVisited: false, anyMarked: false };
    }
    const danielStatus = place.daniel_status || (place.added_by === 'daniel' ? place.status : null);
    const huaiyaoStatus = place.huaiyao_status || (place.added_by === 'huaiyao' ? place.status : null);
    return {
      danielStatus,
      huaiyaoStatus,
      bothWantToGo: danielStatus === 'wishlist' && huaiyaoStatus === 'wishlist',
      bothVisited: danielStatus === 'visited' && huaiyaoStatus === 'visited',
      anyMarked: danielStatus !== null || huaiyaoStatus !== null,
    };
  };

  // Color function based on BOTH users' statuses
  const getLocationColor = (locationKey: string, name: string, regionCode: string): string => {
    const place = getPlaceForLocation(locationKey, name);
    const { danielStatus, huaiyaoStatus, bothWantToGo, bothVisited } = getDualStatus(place);
    const regionColors = REGION_COLORS[regionCode] || DEFAULT_COLOR;

    if (!danielStatus && !huaiyaoStatus) return regionColors.default;

    // BOTH want to go - gold (this is what we want to highlight!)
    if (bothWantToGo) return '#f59e0b'; // amber-500

    // BOTH have visited - special green
    if (bothVisited) return '#10b981'; // emerald-500

    // Mixed: one visited, one wants to go - teal
    if ((danielStatus === 'visited' && huaiyaoStatus === 'wishlist') ||
        (danielStatus === 'wishlist' && huaiyaoStatus === 'visited')) {
      return '#14b8a6'; // teal-500
    }

    // Only one person marked it
    if (danielStatus && !huaiyaoStatus) {
      return danielStatus === 'visited' ? '#1d4ed8' : '#93c5fd'; // blue-700 : blue-300
    }
    if (huaiyaoStatus && !danielStatus) {
      return huaiyaoStatus === 'visited' ? '#be123c' : '#fda4af'; // rose-700 : rose-300
    }

    // Fallback
    return regionColors.default;
  };

  // Count places where BOTH want to go (gold), and total unique marked places
  const totalBothWantToGo = regions.reduce((sum, r) =>
    sum + r.places.filter(p => {
      const ds = p.daniel_status || (p.added_by === 'daniel' ? p.status : null);
      const hs = p.huaiyao_status || (p.added_by === 'huaiyao' ? p.status : null);
      return ds === 'wishlist' && hs === 'wishlist';
    }).length, 0);

  const totalWishlist = regions.reduce((sum, r) =>
    sum + r.places.filter(p => {
      const ds = p.daniel_status || (p.added_by === 'daniel' ? p.status : null);
      const hs = p.huaiyao_status || (p.added_by === 'huaiyao' ? p.status : null);
      return ds === 'wishlist' || hs === 'wishlist';
    }).length, 0);

  const totalVisited = regions.reduce((sum, r) =>
    sum + r.places.filter(p => {
      const ds = p.daniel_status || (p.added_by === 'daniel' ? p.status : null);
      const hs = p.huaiyao_status || (p.added_by === 'huaiyao' ? p.status : null);
      return ds === 'visited' || hs === 'visited';
    }).length, 0);

  // User selection screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity }} className="text-6xl mb-6">
            🗺️
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-white mb-4">Who are you?</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">So we know who to notify when you make changes</p>
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-teal-200 border-t-teal-500 rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-100/30 dark:bg-teal-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-100/30 dark:bg-cyan-900/20 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-6 sm:py-12 pb-safe">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6 sm:mb-8">
          <div className="flex items-center justify-between mb-4">
            <a href="/" className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 transition-colors touch-manipulation">
              ← Home
            </a>
            <ThemeToggle />
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-white mb-2">Our Travel Map</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {totalBothWantToGo > 0 && <span className="text-amber-500 font-medium">{totalBothWantToGo} both want</span>}
            {totalBothWantToGo > 0 && ' · '}
            {totalWishlist} wishlist · {totalVisited} visited
          </p>
          {/* Color legend */}
          <div className="flex flex-wrap justify-center gap-3 mt-3 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-amber-500"></div>
              <span className="text-gray-500 dark:text-gray-400">Both want</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
              <span className="text-gray-500 dark:text-gray-400">Both visited</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-blue-400"></div>
              <span className="text-gray-500 dark:text-gray-400">Daniel</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-rose-400"></div>
              <span className="text-gray-500 dark:text-gray-400">Huaiyao</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-3">
            <button
              onClick={() => setShowStats(true)}
              className="px-3 py-2 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-lg text-sm font-medium hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors"
            >
              📊 Stats
            </button>
            <button
              onClick={() => setShowTripPlanner(true)}
              className="px-3 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-sm font-medium hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
            >
              ✈️ Plan Trip
            </button>
            {memoryLocations.length > 0 && (
              <button
                onClick={() => setShowMemories(!showMemories)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showMemories
                    ? 'bg-purple-500 text-white'
                    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50'
                }`}
              >
                📍 Memories ({memoryLocations.length})
              </button>
            )}
            <button
              onClick={() => setShowDetailedMap(true)}
              className="px-3 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            >
              🔍 Zoom In
            </button>
          </div>
        </motion.div>

        {/* Back button and controls when zoomed */}
        {zoomedRegion && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-4 flex flex-wrap items-center gap-2"
          >
            <button
              onClick={() => {
                setZoomedRegion(null);
                setShowUSStates(false);
              }}
              className="px-4 py-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-lg shadow-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to World
            </button>

            {/* US States toggle - only show in North America */}
            {zoomedRegion === 'north-america' && (
              <button
                onClick={() => setShowUSStates(!showUSStates)}
                className={`px-4 py-2 rounded-lg shadow-sm transition-colors flex items-center gap-2 ${
                  showUSStates
                    ? 'bg-blue-500 text-white'
                    : 'bg-white/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white'
                }`}
              >
                🇺🇸 {showUSStates ? 'Show Countries' : 'Show US States'}
              </button>
            )}
          </motion.div>
        )}

        {/* Map Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-2xl shadow-lg p-4 sm:p-6 mb-6 overflow-hidden"
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
                    const fillColor = getLocationColor(stateCode, stateName, 'north-america');
                    const colors = REGION_COLORS['north-america'];

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onClick={() => handleLocationClick(stateName, stateCode, true)}
                        style={{
                          default: {
                            fill: fillColor,
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

              {/* Memory markers in US States view */}
              {showMemories && memoryLocations
                .filter(m => m.location_lng >= -125 && m.location_lng <= -66 && m.location_lat >= 24 && m.location_lat <= 50)
                .map((memory) => (
                  <Marker key={memory.id} coordinates={[memory.location_lng, memory.location_lat]}>
                    <g style={{ cursor: 'pointer' }}>
                      <circle r={6} fill="#a855f7" stroke="#fff" strokeWidth={2} />
                      <title>{memory.title} - {memory.location_name}</title>
                    </g>
                  </Marker>
                ))}
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
                      const fillColor = getLocationColor(countryName, countryName, zoomedRegion);
                      const colors = REGION_COLORS[zoomedRegion] || DEFAULT_COLOR;

                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          onClick={() => handleLocationClick(countryName, countryName, false)}
                          style={{
                            default: {
                              fill: fillColor,
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

              {/* Memory markers in zoomed region */}
              {showMemories && memoryLocations.map((memory) => (
                <Marker key={memory.id} coordinates={[memory.location_lng, memory.location_lat]}>
                  <g style={{ cursor: 'pointer' }}>
                    <circle r={8} fill="#a855f7" stroke="#fff" strokeWidth={2} />
                    <title>{memory.title} - {memory.location_name}</title>
                  </g>
                </Marker>
              ))}
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
                    const fillColor = regionCode ? getLocationColor(countryName, countryName, regionCode) : colors.default;

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onClick={() => {
                          if (regionCode) {
                            setZoomedRegion(regionCode);
                            // Also open location modal for this country
                            handleLocationClick(countryName, countryName, false);
                          }
                        }}
                        style={{
                          default: {
                            fill: fillColor,
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

              {/* Memory location markers */}
              {showMemories && memoryLocations.map((memory) => (
                <Marker key={memory.id} coordinates={[memory.location_lng, memory.location_lat]}>
                  <g
                    onClick={(e) => {
                      e.stopPropagation();
                      // Could show memory details here
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle r={6} fill="#a855f7" stroke="#fff" strokeWidth={2} />
                    <title>{memory.title} - {memory.location_name}</title>
                  </g>
                </Marker>
              ))}
            </ComposableMap>
          )}

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-4 mt-4 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-gray-300" />
              <span>Not added</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#93c5fd' }} />
              <span>Daniel wishlist</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#1d4ed8' }} />
              <span>Daniel visited</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#fda4af' }} />
              <span>Huaiyao wishlist</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#be123c' }} />
              <span>Huaiyao visited</span>
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl shadow-sm p-4 mb-6">
          <p className="text-center text-gray-500 dark:text-gray-400 text-sm">
            {zoomedRegion
              ? 'Click a country or state to add it to your wishlist or mark as visited'
              : 'Click a region to zoom in, then click countries to add them'}
          </p>
        </motion.div>

        {/* Location Action Modal - Dual Status */}
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
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-serif font-bold text-gray-800 dark:text-white mb-1">
                  {clickedLocation.name}
                </h3>
                {clickedLocation.isState && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">United States</p>
                )}

                {(() => {
                  const place = getPlaceForLocation(clickedLocation.key, clickedLocation.name);
                  const { danielStatus, huaiyaoStatus, bothWantToGo, bothVisited } = getDualStatus(place);

                  // Show special banner if both want to go
                  const showBanner = bothWantToGo || bothVisited;

                  return (
                    <div className="space-y-4">
                      {/* Special banner for both */}
                      {showBanner && (
                        <div className={`text-center py-2 px-3 rounded-lg ${
                          bothWantToGo ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                          'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {bothWantToGo ? '✨ You both want to visit!' : '🎉 You\'ve both been here!'}
                        </div>
                      )}

                      {/* Daniel's status */}
                      <div className="border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-blue-700 dark:text-blue-300">Daniel</span>
                          {danielStatus && (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              danielStatus === 'visited' ? 'bg-blue-700 text-white' : 'bg-blue-200 text-blue-700'
                            }`}>
                              {danielStatus === 'visited' ? '✓ Visited' : '★ Wishlist'}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => addPlace(clickedLocation.name, clickedLocation.key, clickedLocation.isState, 'wishlist', 'daniel')}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                              danielStatus === 'wishlist'
                                ? 'bg-blue-500 text-white'
                                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                            }`}
                          >
                            Wishlist
                          </button>
                          <button
                            onClick={() => addPlace(clickedLocation.name, clickedLocation.key, clickedLocation.isState, 'visited', 'daniel')}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                              danielStatus === 'visited'
                                ? 'bg-blue-700 text-white'
                                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                            }`}
                          >
                            Visited
                          </button>
                          {danielStatus && (
                            <button
                              onClick={() => clearPlaceStatus(place?.id, 'daniel')}
                              className="px-2 py-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Clear"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Huaiyao's status */}
                      <div className="border border-rose-200 dark:border-rose-800 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-rose-700 dark:text-rose-300">Huaiyao</span>
                          {huaiyaoStatus && (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              huaiyaoStatus === 'visited' ? 'bg-rose-700 text-white' : 'bg-rose-200 text-rose-700'
                            }`}>
                              {huaiyaoStatus === 'visited' ? '✓ Visited' : '★ Wishlist'}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => addPlace(clickedLocation.name, clickedLocation.key, clickedLocation.isState, 'wishlist', 'huaiyao')}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                              huaiyaoStatus === 'wishlist'
                                ? 'bg-rose-500 text-white'
                                : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50'
                            }`}
                          >
                            Wishlist
                          </button>
                          <button
                            onClick={() => addPlace(clickedLocation.name, clickedLocation.key, clickedLocation.isState, 'visited', 'huaiyao')}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                              huaiyaoStatus === 'visited'
                                ? 'bg-rose-700 text-white'
                                : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50'
                            }`}
                          >
                            Visited
                          </button>
                          {huaiyaoStatus && (
                            <button
                              onClick={() => clearPlaceStatus(place?.id, 'huaiyao')}
                              className="px-2 py-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Clear"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Photo gallery if either has visited */}
                      {place && (danielStatus === 'visited' || huaiyaoStatus === 'visited') && (
                        <button
                          onClick={() => {
                            setPhotoGalleryPlace({ id: place.id, name: clickedLocation.name });
                            setClickedLocation(null);
                          }}
                          className="w-full py-3 bg-teal-500 text-white rounded-xl font-medium hover:bg-teal-600 transition-colors flex items-center justify-center gap-2"
                        >
                          <span>📷</span> View Photos
                        </button>
                      )}

                      <button
                        onClick={() => setClickedLocation(null)}
                        className="w-full py-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        Close
                      </button>
                    </div>
                  );
                })()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats Panel */}
        <AnimatePresence>
          {showStats && (
            <StatsPanel regions={regions} onClose={() => setShowStats(false)} />
          )}
        </AnimatePresence>

        {/* Photo Gallery */}
        <AnimatePresence>
          {photoGalleryPlace && currentUser && (
            <PhotoGallery
              placeId={photoGalleryPlace.id}
              placeName={photoGalleryPlace.name}
              currentUser={currentUser}
              onClose={() => setPhotoGalleryPlace(null)}
            />
          )}
        </AnimatePresence>

        {/* Trip Planner */}
        <AnimatePresence>
          {showTripPlanner && currentUser && (
            <TripPlanner
              currentUser={currentUser}
              onClose={() => setShowTripPlanner(false)}
            />
          )}
        </AnimatePresence>

        {/* Detailed Leaflet Map */}
        <AnimatePresence>
          {showDetailedMap && (
            <LeafletMap
              memories={memoryLocations}
              onClose={() => setShowDetailedMap(false)}
            />
          )}
        </AnimatePresence>

        {/* Memory Locations Section */}
        <AnimatePresence>
          {showMemories && memoryLocations.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-2xl shadow-lg p-4 mb-6"
            >
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
                <span>📍</span> Memory Locations
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {memoryLocations.map((memory) => (
                  <a
                    key={memory.id}
                    href={`/memories`}
                    className="block p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-medium text-gray-800 dark:text-white truncate">{memory.title}</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{memory.location_name}</p>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {new Date(memory.memory_date).toLocaleDateString()}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
                Add locations to memories to see them here
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 dark:text-gray-500 text-sm">
          <p className="mt-2">
            Logged in as{' '}
            <span className={currentUser === 'daniel' ? 'text-blue-500' : 'text-rose-500'}>
              {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </span>
            {' · '}
            <button
              onClick={() => {
                localStorage.removeItem('currentUser');
                setCurrentUser(null);
              }}
              className="underline hover:text-gray-600 dark:hover:text-gray-300"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}
