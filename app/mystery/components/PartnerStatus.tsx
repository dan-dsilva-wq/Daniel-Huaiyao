'use client';

import { motion } from 'framer-motion';
import type { Player } from '@/lib/supabase';

interface PartnerStatusProps {
  currentPlayer: Player;
  danielOnline: boolean;
  huaiyaoOnline: boolean;
  danielLastSeen: string | null;
  huaiyaoLastSeen: string | null;
}

function isRecentlyOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  const diffMs = now.getTime() - lastSeenDate.getTime();
  return diffMs < 30000; // 30 seconds
}

export default function PartnerStatus({
  currentPlayer,
  danielOnline,
  huaiyaoOnline,
  danielLastSeen,
  huaiyaoLastSeen,
}: PartnerStatusProps) {
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';
  const partnerOnline = currentPlayer === 'daniel'
    ? (huaiyaoOnline || isRecentlyOnline(huaiyaoLastSeen))
    : (danielOnline || isRecentlyOnline(danielLastSeen));
  const partnerColor = currentPlayer === 'daniel' ? 'rose' : 'blue';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-3 py-2 bg-white/10 backdrop-blur rounded-full"
    >
      <div className="relative">
        <motion.div
          animate={partnerOnline ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
          className={`w-3 h-3 rounded-full ${
            partnerOnline
              ? `bg-${partnerColor}-500`
              : 'bg-gray-500'
          }`}
        />
        {partnerOnline && (
          <motion.div
            animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className={`absolute inset-0 w-3 h-3 rounded-full bg-${partnerColor}-500`}
          />
        )}
      </div>
      <span className="text-sm text-white/80">
        {partnerName} is {partnerOnline ? 'here' : 'away'}
      </span>
    </motion.div>
  );
}
