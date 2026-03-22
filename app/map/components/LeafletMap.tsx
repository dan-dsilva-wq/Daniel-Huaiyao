'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MemoryLocation {
  id: string;
  title: string;
  location_name: string;
  location_lat: number;
  location_lng: number;
  memory_date: string;
}

interface LeafletMapProps {
  center?: [number, number];
  zoom?: number;
  memories?: MemoryLocation[];
  onClose: () => void;
}

export default function LeafletMap({
  center = [20, 0],
  zoom = 2,
  memories = [],
  onClose
}: LeafletMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const syncSize = (map: L.Map) => {
      window.requestAnimationFrame(() => {
        map.invalidateSize(false);
      });
    };

    // Initialize the map
    const map = L.map(mapRef.current, {
      center: center,
      zoom: zoom,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Custom purple marker icon for memories
    const memoryIcon = L.divIcon({
      html: `<div style="
        width: 24px;
        height: 24px;
        background: #a855f7;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      "></div>`,
      className: 'custom-memory-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    // Add memory markers
    memories.forEach((memory) => {
      if (memory.location_lat && memory.location_lng) {
        const marker = L.marker([memory.location_lat, memory.location_lng], { icon: memoryIcon })
          .addTo(map);

        marker.bindPopup(`
          <div style="min-width: 150px;">
            <strong>${memory.title}</strong><br/>
            <span style="color: #666; font-size: 12px;">${memory.location_name}</span><br/>
            <span style="color: #999; font-size: 11px;">${new Date(memory.memory_date).toLocaleDateString()}</span>
          </div>
        `);
      }
    });

    mapInstanceRef.current = map;

    const resizeTimers = [
      window.setTimeout(() => syncSize(map), 0),
      window.setTimeout(() => syncSize(map), 250),
      window.setTimeout(() => syncSize(map), 750),
    ];
    const handleResize = () => syncSize(map);
    const visualViewport = window.visualViewport;
    map.whenReady(() => syncSize(map));
    window.addEventListener('resize', handleResize);
    visualViewport?.addEventListener('resize', handleResize);
    visualViewport?.addEventListener('scroll', handleResize);

    // Cleanup
    return () => {
      resizeTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('resize', handleResize);
      visualViewport?.removeEventListener('resize', handleResize);
      visualViewport?.removeEventListener('scroll', handleResize);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [center, zoom, memories]);

  // Update view when center/zoom changes
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView(center, zoom);
      window.requestAnimationFrame(() => {
        mapInstanceRef.current?.invalidateSize(false);
      });
    }
  }, [center, zoom]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex min-h-full items-start justify-center overflow-y-auto bg-black/80 p-0 sm:p-4 sm:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="flex min-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 sm:my-4 sm:h-[80vh] sm:min-h-0 sm:max-h-[48rem] sm:rounded-2xl"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-gray-200 p-3 dark:border-gray-700 sm:p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
            Detailed Map View
          </h2>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Use +/-, pinch, or double-click to zoom
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Map Container */}
        <div ref={mapRef} className="min-h-0 flex-1 w-full" />

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 p-3 text-sm dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-purple-500 border-2 border-white shadow"></div>
            <span className="text-gray-600 dark:text-gray-400">Memories</span>
          </div>
          <span className="text-gray-400 dark:text-gray-500">|</span>
          <span className="text-gray-500 dark:text-gray-400">
            Zoom: +/- buttons, double-click, or pinch • Pan: Click and drag
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
