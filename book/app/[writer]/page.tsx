'use client';

import { useParams, notFound } from 'next/navigation';
import Book from '@/components/Book';
import SoundEffects from '@/components/SoundEffects';
import { Writer } from '@/lib/supabase';

const validWriters: Writer[] = ['daniel', 'huaiyao'];

export default function WriterPage() {
  const params = useParams();
  const writerParam = params.writer as string;

  // Validate writer
  if (!validWriters.includes(writerParam as Writer)) {
    notFound();
  }

  const writer = writerParam as Writer;

  return (
    <>
      <Book currentWriter={writer} title="Death on a Desert Island" />
      <SoundEffects />
    </>
  );
}
