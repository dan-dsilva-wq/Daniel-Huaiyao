# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Vision

### What This Is
A private couples website for Daniel & Huaiyao - a collection of interactive mini-apps designed to keep their relationship playful, connected, and full of shared moments, whether they're together or apart.

### Why It Exists
Long-distance relationships and busy lives can make it hard to stay connected in meaningful ways beyond texting. This app creates little rituals and shared experiences:
- A gratitude wall to appreciate each other daily
- A collaborative story they write together, one sentence at a time
- A map of places they've been and want to go
- Mystery games they solve as a team
- A quiz to see how well they know each other
- Memories to look back on together

It's not about productivity or metrics - it's about creating small moments of joy and connection throughout the day.

### Design Philosophy

**1. Feel Alive, Not Static**
The app should feel like the other person is "there" even when they're not. This means:
- Real-time updates when your partner does something
- Typing indicators so you know they're present
- Push notifications that create anticipation
- "On this day" flashbacks to resurface shared memories
- Partner status showing what they're up to

**2. Low Friction, High Delight**
Every interaction should be effortless:
- No login/passwords - just pick who you are
- One-tap actions where possible
- Beautiful animations that feel responsive
- Mobile-first design (it's a PWA they use on their phones)

**3. Together, Not Competitive**
Features should bring them together, not pit them against each other:
- Joint achievements they unlock as a team
- Shared streaks (both need to participate)
- Collaborative features (story, mystery) over solo ones
- Stats show "us" not "me vs you"

**4. Gentle Nudges, Not Nagging**
Notifications should feel like a loving tap on the shoulder:
- "Huaiyao left you a note" (not "You haven't opened the app in 3 days!")
- Evening gratitude reminders only if neither has written
- Red dots for new content, not guilt-inducing streaks

**5. Personal and Evolving**
This is THEIR app, built for their specific relationship:
- Features based on what they actually enjoy
- Huaiyao can suggest changes via the feedback chat
- Inside jokes and personal touches welcome
- No need for generic "couple app" features they won't use

### Current Apps

| App | Purpose |
|-----|---------|
| **Gratitude Wall** | Daily notes of appreciation to each other |
| **Story Book** | Collaborative story, one sentence at a time |
| **Quiz** | Questions about each other to test how well they know one another |
| **Memories** | Photo-rich timeline of moments together |
| **Map** | Places visited and bucket list destinations |
| **Mystery** | AI-driven story games they solve together |
| **Countdown** | Events they're looking forward to |
| **Dates** | Date ideas to try together |
| **Media** | Shows/movies to watch together |
| **Hive** | Board game to play against each other |
| **Prompts** | Daily questions to spark conversation |
| **Stats** | Overview of their shared activity |

### Future Direction

**More "Alive" Features**
- Memory flashbacks on the home page ("3 years ago today...")
- Activity feed showing partner's recent actions
- Partner presence indicator

**Deeper Connection Features**
- Voice/video messages in chat
- Shared playlists or music moments
- Dream journal they can share
- Letters for future dates (time capsule)

**Quality of Life**
- Better photo management in memories
- Search across all content
- Export/backup of their data
- Anniversary and milestone celebrations

### What NOT to Build
- Social features (this is private, just for them)
- Gamification that creates pressure or guilt
- Features that feel like chores
- Anything that requires daily obligation
- Generic features they won't actually use

---

## Build Commands

```bash
npm run dev    # Start development server (Next.js)
npm run build  # Production build - run this before committing to catch type errors
npm run lint   # Run ESLint
```

## Architecture Overview

This is a couples website for Daniel & Huaiyao with multiple interactive apps. It uses:
- **Next.js 16** with App Router (all pages in `/app`)
- **React 19** with client components (`'use client'` directive)
- **Tailwind 4** for styling (supports dark mode via `dark:` prefix)
- **Framer Motion** for animations
- **Supabase** for database and real-time features
- **Vercel** for deployment

### User Identity Pattern
Users are identified by `'daniel' | 'huaiyao'` stored in `localStorage.getItem('currentUser')`. There is no authentication - users self-select on first visit.

### Database Pattern
All database operations use Supabase RPC functions rather than direct table access:
```typescript
const { data, error } = await supabase.rpc('function_name', { p_param: value });
```

RPC functions are defined in SQL migrations under `/supabase/migrations/`. When adding features:
1. Create a new migration file with timestamp prefix: `YYYYMMDDHHMMSS_description.sql`
2. Define tables with RLS enabled and permissive policies
3. Create RPC functions for all data operations
4. User must manually run migrations in Supabase SQL Editor

### Key Shared Code

- `lib/supabase.ts` - Supabase client and TypeScript interfaces
- `lib/useMarkAppViewed.ts` - Hook to track app visits for notification badges
- `app/components/ThemeProvider.tsx` - Dark mode context
- `app/api/notify/route.ts` - Push notification API (notifies the OTHER user)

### App Structure

Each app follows this pattern:
- Page at `/app/[appname]/page.tsx` with `'use client'`
- Gets `currentUser` from localStorage on mount
- Calls `useMarkAppViewed('appname')` to clear notification badge
- Uses Supabase RPC functions for data operations

### Notification System

The home page shows red dots for apps with new content. This is powered by:
- `get_new_item_counts(p_user_name)` RPC returns counts of unseen items per app
- `mark_app_viewed(p_user_name, p_app_name)` RPC updates last viewed timestamp
- Push notifications via `/app/api/notify/route.ts` with VAPID keys

### PWA Support

The app is installable as a PWA:
- Manifest at `/public/manifest.json`
- Service worker at `/public/sw.js` with version-based cache invalidation
- When making significant JS changes, bump SW cache version to force refresh

## App-Specific Notes

### Hive Game (`/app/hive`)
Board game with complex rules in `/lib/hive/`:
- `types.ts` - Game state and piece types
- `hexUtils.ts` - Axial coordinate math
- `hiveRules.ts` - Main game logic
- `pieceMovement/*.ts` - Movement rules per piece type

### Mystery Files (`/app/mystery`)
Interactive story game with:
- AI-driven mode using OpenAI
- Puzzle system with multiple types
- Real-time sync between players via Supabase subscriptions
- Branch visualization for completed stories

### Map (`/app/map`)
Uses Leaflet for the interactive map:
- Component at `/app/map/components/LeafletMap.tsx`
- Photo gallery integrates photos from both map and memories tables
- Stats panel shows visited countries/states

## Common Gotchas

1. **React conditional rendering**: `{0 && <Component/>}` renders "0" as text. Use `{count > 0 && <Component/>}` instead.

2. **Supabase RPC column names**: Check actual column names in migrations - e.g., `quiz_questions` uses `author` not `added_by`.

3. **TypeScript strict mode**: Build will fail on type errors. Run `npm run build` locally before pushing.

4. **Service worker caching**: After JS changes, users may see old code. Bump cache version in `/public/sw.js`.
