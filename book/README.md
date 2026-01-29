# Couples' Shared Story Book

A romantic, turn-based collaborative writing website styled as a beautiful pastel book. Daniel and Huaiyao each get their own unique link and take turns writing sentences to build a story together.

## Features

- Beautiful pastel-colored book design with soft gradients
- Page-flip animations with Framer Motion
- Turn-based writing with strict enforcement
- Realtime updates via Supabase
- Unique links for each writer (`/daniel` and `/huaiyao`)
- Sound effects for interactions
- Mobile responsive design

## Tech Stack

- **Frontend**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL + Realtime)
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion

## Getting Started

### 1. Clone and Install

```bash
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to the SQL Editor in your Supabase dashboard
3. Run the SQL from `supabase-schema.sql` to create the tables
4. Enable Realtime for the `sentences` table (already in the SQL file)

### 3. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

You can find these in your Supabase project settings under API.

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the landing page.

## Usage

- **Daniel's Link**: `http://localhost:3000/daniel`
- **Huaiyao's Link**: `http://localhost:3000/huaiyao`

Each person should bookmark their own link. The book enforces turn-based writing - you can only write when it's your turn!

## Adding Sound Effects (Optional)

Add the following MP3 files to `/public/sounds/`:

- `page-flip.mp3` - Page turning sound
- `submit.mp3` - Sentence submission chime
- `notification.mp3` - Your turn notification

Free sounds available at [freesound.org](https://freesound.org) or [mixkit.co](https://mixkit.co/free-sound-effects/).

## Deployment on Vercel

1. Push your code to GitHub
2. Connect your repo to [Vercel](https://vercel.com)
3. Add environment variables in Vercel project settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy!

## Project Structure

```
/app
  /page.tsx              - Landing page with writer selection
  /[writer]/page.tsx     - Main book view (daniel/huaiyao)
  /not-found.tsx         - 404 page
  /layout.tsx            - Root layout
  /globals.css           - Global styles
/components
  /Book.tsx              - Main book container
  /Page.tsx              - Individual page component
  /WriteInput.tsx        - Sentence input form
  /TurnIndicator.tsx     - Shows whose turn
  /SoundEffects.tsx      - Audio toggle button
/lib
  /supabase.ts           - Supabase client & types
  /sounds.ts             - Sound effect utilities
/public
  /sounds/               - Audio files
```
