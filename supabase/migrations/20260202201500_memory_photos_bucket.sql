-- Create memory-photos storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'memory-photos',
  'memory-photos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy to allow public read access
CREATE POLICY "Allow public read memory photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'memory-photos');

-- Storage policy to allow authenticated uploads
CREATE POLICY "Allow authenticated memory photo uploads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'memory-photos');

-- Storage policy to allow owner deletes
CREATE POLICY "Allow memory photo deletes"
ON storage.objects FOR DELETE
USING (bucket_id = 'memory-photos');
