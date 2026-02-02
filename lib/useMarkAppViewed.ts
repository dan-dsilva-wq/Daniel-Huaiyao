'use client';

import { useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';

export function useMarkAppViewed(appName: string) {
  useEffect(() => {
    const markViewed = async () => {
      const currentUser = localStorage.getItem('currentUser');
      if (!currentUser || !isSupabaseConfigured) return;

      try {
        await supabase.rpc('mark_app_viewed', {
          p_user_name: currentUser,
          p_app_name: appName,
        });
      } catch (err) {
        console.error('Error marking app as viewed:', err);
      }
    };

    markViewed();
  }, [appName]);
}
