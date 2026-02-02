-- Add "Would I Lie To You" category
INSERT INTO quiz_categories (name, emoji, description, sort_order)
VALUES ('WILTY', '🎭', 'Would I Lie To You - True or false stories', 10)
ON CONFLICT (name) DO NOTHING;
