-- Create map-photos storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'map-photos',
  'map-photos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy to allow authenticated uploads
CREATE POLICY "Allow public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'map-photos');

CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'map-photos');

CREATE POLICY "Allow owner deletes"
ON storage.objects FOR DELETE
USING (bucket_id = 'map-photos');
