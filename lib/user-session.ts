'use client';

const STORAGE_KEY = 'currentUser';
const COOKIE_KEY = 'dh_current_user';
const KNOWN_USERS = new Set(['daniel', 'huaiyao']);

export type CurrentUser = 'daniel' | 'huaiyao';

function normalizeUser(value: string | null | undefined): CurrentUser | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  if (!KNOWN_USERS.has(normalized)) return null;
  return normalized as CurrentUser;
}

function setUserCookie(user: CurrentUser) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_KEY}=${user}; path=/; max-age=31536000; samesite=lax`;
}

function getUserCookie(): CurrentUser | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_KEY}=`));
  if (!cookie) return null;
  return normalizeUser(cookie.split('=')[1]);
}

export function getCurrentUser(): CurrentUser | null {
  if (typeof window === 'undefined') return null;

  const fromStorage = normalizeUser(window.localStorage.getItem(STORAGE_KEY));
  if (fromStorage) {
    setUserCookie(fromStorage);
    return fromStorage;
  }

  const fromCookie = getUserCookie();
  if (fromCookie) {
    window.localStorage.setItem(STORAGE_KEY, fromCookie);
    return fromCookie;
  }

  return null;
}

export function setCurrentUser(user: CurrentUser) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, user);
  setUserCookie(user);
}

export function clearCurrentUser() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; samesite=lax`;
}
