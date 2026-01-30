'use client';

import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface Place {
  id: string;
  name: string;
  country: string | null;
  location_key: string | null; // Country name or "US-XX" for US states
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

// Reverse lookup for US states
const US_STATE_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([name, code]) => [code, name])
);

// All countries list for autocomplete
const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Belarus', 'Belgium', 'Belize',
  'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil',
  'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros',
  'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Djibouti',
  'Dominican Republic', 'DR Congo', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
  'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon',
  'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Greenland', 'Guatemala', 'Guinea',
  'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India',
  'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica',
  'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos',
  'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Mali', 'Malta', 'Mauritania', 'Mauritius',
  'Mexico', 'Moldova', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria',
  'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar',
  'Romania', 'Russia', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Sierra Leone',
  'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa',
  'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden',
  'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste',
  'Togo', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'Uruguay', 'Uzbekistan', 'Vanuatu',
  'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

// Map country names to their TopoJSON names (for matching)
const COUNTRY_NAME_MAP: Record<string, string> = {
  'United States': 'United States of America',
  'USA': 'United States of America',
  'UK': 'United Kingdom',
  'Czech Republic': 'Czech Rep.',
  'Dominican Republic': 'Dominican Rep.',
  'DR Congo': 'Dem. Rep. Congo',
  'Central African Republic': 'Central African Rep.',
  'Ivory Coast': "Côte d'Ivoire",
  'North Macedonia': 'Macedonia',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'South Sudan': 'S. Sudan',
  'Equatorial Guinea': 'Eq. Guinea',
  'Solomon Islands': 'Solomon Is.',
  'Eswatini': 'eSwatini',
  'Western Sahara': 'W. Sahara',
};

// Reverse mapping for display
const TOPO_TO_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_NAME_MAP).map(([display, topo]) => [topo, display])
);

// All autocomplete options: US states + countries
const ALL_LOCATIONS = [
  ...Object.keys(US_STATES).map(state => ({ name: state, type: 'state' as const, key: US_STATES[state] })),
  ...COUNTRIES.map(country => ({ name: country, type: 'country' as const, key: country })),
];

// Map countries to regions by continent
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

// Region colors
const REGION_COLORS: Record<string, { default: string; visited: string; hover: string }> = {
  'north-america': { default: '#38bdf8', visited: '#0369a1', hover: '#0ea5e9' },
  'south-america': { default: '#34d399', visited: '#047857', hover: '#10b981' },
  'europe': { default: '#a78bfa', visited: '#6d28d9', hover: '#8b5cf6' },
  'africa': { default: '#fbbf24', visited: '#b45309', hover: '#f59e0b' },
  'asia': { default: '#fb7185', visited: '#be123c', hover: '#f43f5e' },
  'oceania': { default: '#60a5fa', visited: '#1d4ed8', hover: '#3b82f6' },
};

const DEFAULT_COLOR = { default: '#e5e7eb', visited: '#9ca3af', hover: '#d1d5db' };

// Memoized World Map component
const WorldMap = memo(function WorldMap({
  visitedLocations,
  selectedRegion,
  hoveredRegion,
  onRegionHover,
  onRegionClick,
}: {
  visitedLocations: Set<string>;
  selectedRegion: Region | null;
  hoveredRegion: string | null;
  onRegionHover: (code: string | null) => void;
  onRegionClick: (code: string) => void;
}) {
  return (
    <ComposableMap
      projection="geoMercator"
      projectionConfig={{ scale: 120, center: [0, 30] }}
      style={{ width: '100%', height: 'auto' }}
    >
      <ZoomableGroup zoom={1} minZoom={1} maxZoom={1}>
        <Geographies geography={worldGeoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const countryName = geo.properties.name;
              // Skip USA - we render it with states
              if (countryName === 'United States of America') return null;

              const regionCode = COUNTRY_TO_REGION[countryName];
              const colors = regionCode ? REGION_COLORS[regionCode] : DEFAULT_COLOR;
              const isVisited = visitedLocations.has(countryName) ||
                visitedLocations.has(TOPO_TO_DISPLAY[countryName] || countryName);
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
                      fill: isVisited ? colors.visited : (isSelected ? colors.hover : colors.default),
                      stroke: '#fff',
                      strokeWidth: 0.5,
                      outline: 'none',
                      cursor: regionCode ? 'pointer' : 'default',
                    },
                    hover: {
                      fill: isVisited ? colors.visited : colors.hover,
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

// Memoized US States Map component
const USMap = memo(function USMap({
  visitedStates,
  onStateClick,
}: {
  visitedStates: Set<string>;
  onStateClick: () => void;
}) {
  return (
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
            const isVisited = visitedStates.has(stateCode) || visitedStates.has(stateName);
            const colors = REGION_COLORS['north-america'];

            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                onClick={onStateClick}
                style={{
                  default: {
                    fill: isVisited ? colors.visited : colors.default,
                    stroke: '#fff',
                    strokeWidth: 0.5,
                    outline: 'none',
                    cursor: 'pointer',
                  },
                  hover: {
                    fill: isVisited ? colors.visited : colors.hover,
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
  );
});

// Autocomplete component
function LocationAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (location: { name: string; type: 'state' | 'country'; key: string }) => void;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const filteredLocations = useMemo(() => {
    if (!value.trim()) return [];
    const search = value.toLowerCase();
    return ALL_LOCATIONS
      .filter(loc => loc.name.toLowerCase().includes(search))
      .slice(0, 8);
  }, [value]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredLocations]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!filteredLocations.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filteredLocations.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredLocations[highlightedIndex]) {
      e.preventDefault();
      onSelect(filteredLocations[highlightedIndex]);
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300"
        autoComplete="off"
      />
      <AnimatePresence>
        {isOpen && filteredLocations.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 w-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-60 overflow-auto"
          >
            {filteredLocations.map((loc, index) => (
              <button
                key={loc.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(loc);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-gray-50 ${
                  index === highlightedIndex ? 'bg-teal-50' : ''
                }`}
              >
                <span>{loc.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  loc.type === 'state' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {loc.type === 'state' ? 'US State' : 'Country'}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MapPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [showUSMap, setShowUSMap] = useState(false);

  // Form state
  const [newPlaceName, setNewPlaceName] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<{ name: string; type: 'state' | 'country'; key: string } | null>(null);
  const [newPlaceNotes, setNewPlaceNotes] = useState('');
  const [addingToRegion, setAddingToRegion] = useState<string | null>(null);

  // Compute visited locations from all places
  const visitedLocations = useMemo(() => {
    const visited = new Set<string>();
    regions.forEach(region => {
      region.places.forEach(place => {
        if (place.status === 'visited' && place.location_key) {
          visited.add(place.location_key);
        }
        // Also add country for backwards compatibility
        if (place.status === 'visited' && place.country) {
          visited.add(place.country);
        }
      });
    });
    return visited;
  }, [regions]);

  // Compute visited US states
  const visitedStates = useMemo(() => {
    const states = new Set<string>();
    visitedLocations.forEach(loc => {
      if (loc.startsWith('US-')) {
        states.add(loc);
      }
    });
    return states;
  }, [visitedLocations]);

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

  const addPlace = async () => {
    if (!newPlaceName.trim() || !addingToRegion) return;

    const locationKey = selectedLocation?.key || null;
    const country = selectedLocation?.type === 'country'
      ? selectedLocation.name
      : selectedLocation?.type === 'state'
        ? 'United States'
        : null;

    const { error } = await supabase.rpc('add_map_place', {
      p_region_id: addingToRegion,
      p_name: newPlaceName.trim(),
      p_country: country,
      p_location_key: locationKey,
      p_status: 'wishlist',
      p_added_by: currentUser,
      p_notes: newPlaceNotes.trim() || null,
    });

    if (error) {
      console.error('Error adding place:', error);
      return;
    }

    sendNotification('place_added', newPlaceName.trim());
    resetForm();
    fetchData();
  };

  const resetForm = () => {
    setNewPlaceName('');
    setSelectedLocation(null);
    setNewPlaceNotes('');
    setShowAddModal(false);
    setAddingToRegion(null);
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
    const { error } = await supabase.rpc('delete_map_place', { p_place_id: place.id });
    if (error) console.error('Error deleting place:', error);
    else fetchData();
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('map-user', user);
  };

  const handleRegionClick = (regionCode: string) => {
    const region = regions.find((r) => r.code === regionCode);
    if (region) setSelectedRegion(region);
  };

  const handleLocationSelect = (location: { name: string; type: 'state' | 'country'; key: string }) => {
    setSelectedLocation(location);
    if (!newPlaceName) {
      setNewPlaceName(location.name);
    }
  };

  // Update selected region when data changes
  useEffect(() => {
    if (selectedRegion) {
      const updated = regions.find((r) => r.code === selectedRegion.code);
      if (updated) setSelectedRegion(updated);
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

        {/* Map Toggle */}
        <div className="flex justify-center gap-2 mb-4">
          <button
            onClick={() => setShowUSMap(false)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !showUSMap ? 'bg-teal-500 text-white' : 'bg-white/70 text-gray-600 hover:bg-white'
            }`}
          >
            World Map
          </button>
          <button
            onClick={() => setShowUSMap(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showUSMap ? 'bg-teal-500 text-white' : 'bg-white/70 text-gray-600 hover:bg-white'
            }`}
          >
            USA States
          </button>
        </div>

        {/* Map Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white/70 backdrop-blur rounded-2xl shadow-lg p-4 sm:p-6 mb-6 overflow-hidden"
        >
          {showUSMap ? (
            <USMap
              visitedStates={visitedStates}
              onStateClick={() => {
                const naRegion = regions.find(r => r.code === 'north-america');
                if (naRegion) setSelectedRegion(naRegion);
              }}
            />
          ) : (
            <WorldMap
              visitedLocations={visitedLocations}
              selectedRegion={selectedRegion}
              hoveredRegion={hoveredRegion}
              onRegionHover={setHoveredRegion}
              onRegionClick={handleRegionClick}
            />
          )}

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#38bdf8' }} />
              <span>Wishlist</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#0369a1' }} />
              <span>Visited</span>
            </div>
          </div>

          {/* Region buttons */}
          {!showUSMap && (
            <div className="flex flex-wrap justify-center gap-2 mt-4 text-xs sm:text-sm">
              {regions.map((region) => {
                const colors = REGION_COLORS[region.code];
                const placeCount = region.places.length;
                return (
                  <button
                    key={region.code}
                    onClick={() => setSelectedRegion(region)}
                    className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-2 ${
                      selectedRegion?.code === region.code ? 'ring-2 ring-offset-2 ring-gray-400' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: colors?.default || '#e5e7eb' }}
                  >
                    <span className="text-white font-medium">{region.display_name}</span>
                    {placeCount > 0 && (
                      <span className="bg-white/30 text-white text-xs px-1.5 py-0.5 rounded-full">{placeCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
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
                background: `linear-gradient(135deg, ${REGION_COLORS[selectedRegion.code]?.default || '#e5e7eb'}, ${REGION_COLORS[selectedRegion.code]?.hover || '#d1d5db'})`,
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl sm:text-2xl font-serif font-bold text-white">{selectedRegion.display_name}</h2>
                <button onClick={() => setSelectedRegion(null)} className="p-2 text-white/70 hover:text-white transition-colors">
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
                      <button
                        onClick={() => togglePlaceStatus(place)}
                        className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          place.status === 'visited' ? 'bg-white border-white text-green-600' : 'border-white/70 hover:border-white'
                        }`}
                      >
                        {place.status === 'visited' && (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>

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
                        {place.country && <div className="text-sm text-white/70">{place.country}</div>}
                        {place.notes && <div className="text-sm text-white/60 mt-1">{place.notes}</div>}
                        {place.visit_date && (
                          <div className="text-xs text-white/50 mt-1">
                            Visited: {new Date(place.visit_date).toLocaleDateString()}
                          </div>
                        )}
                      </div>

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

        {/* Quick add section */}
        {!selectedRegion && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white/70 backdrop-blur rounded-xl shadow-sm p-4 mb-6">
            <p className="text-center text-gray-500">Click a region on the map to see places or add new ones</p>
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
              onClick={resetForm}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-serif font-bold text-gray-800 mb-4">Add New Place</h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Location (type to search)
                    </label>
                    <LocationAutocomplete
                      value={selectedLocation?.name || ''}
                      onChange={(value) => {
                        if (!value) setSelectedLocation(null);
                      }}
                      onSelect={handleLocationSelect}
                      placeholder="e.g., Florida, Japan, France..."
                    />
                    {selectedLocation && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          selectedLocation.type === 'state' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {selectedLocation.type === 'state' ? `US State: ${selectedLocation.name}` : `Country: ${selectedLocation.name}`}
                        </span>
                        <button
                          onClick={() => setSelectedLocation(null)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Place Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Tokyo Tower, Grand Canyon"
                      value={newPlaceName}
                      onChange={(e) => setNewPlaceName(e.target.value)}
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
                  <button onClick={resetForm} className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">
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
        <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 text-sm">
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
