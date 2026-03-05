-- Ensure there is a unique daily prompt for every remaining day in the current year.
-- Also pre-schedules missing daily_prompts rows so each date is fixed ahead of time.

WITH category_ids AS (
  SELECT array_agg(id ORDER BY sort_order, name) AS ids
  FROM prompt_categories
),
target_dates AS (
  SELECT
    gs::date AS prompt_date,
    ROW_NUMBER() OVER (ORDER BY gs::date) AS rn
  FROM generate_series(
      CURRENT_DATE,
      (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date,
      INTERVAL '1 day'
    ) AS gs
  WHERE NOT EXISTS (
    SELECT 1
    FROM daily_prompts dp
    WHERE dp.prompt_date = gs::date
  )
),
openers AS (
  SELECT ARRAY[
    'What felt most meaningful',
    'Share a moment from today when',
    'What is one thing you noticed about us when',
    'What conversation would you love to have about',
    'What surprised you recently about',
    'If we paused and reflected on',
    'What do you want me to understand better about',
    'What do you appreciate most when it comes to',
    'What would make you feel more supported around',
    'What has changed in the way you see'
  ]::TEXT[] AS values
),
topics AS (
  SELECT ARRAY[
    'our communication',
    'how we handle stress',
    'our routines',
    'our future together',
    'the way we celebrate wins',
    'our shared goals',
    'how we reconnect after busy days',
    'our quality time',
    'how we show care',
    'the little things we do'
  ]::TEXT[] AS values
),
closers AS (
  SELECT ARRAY[
    'and why?',
    'that made it stand out?',
    'that you want more of?',
    'that you want to improve together?',
    'that made you feel close to me?',
    'that you are most excited about next?',
    'that helped you feel understood?',
    'that felt especially kind?',
    'that made you smile?',
    'that you want us to remember?'
  ]::TEXT[] AS values
),
generated AS (
  SELECT
    td.prompt_date,
    c.ids[((td.rn - 1) % array_length(c.ids, 1)) + 1] AS category_id,
    format(
      '[Auto %s] %s %s %s',
      to_char(td.prompt_date, 'YYYY-MM-DD'),
      o.values[((td.rn - 1) % array_length(o.values, 1)) + 1],
      t.values[((td.rn * 3 - 1) % array_length(t.values, 1)) + 1],
      cl.values[((td.rn * 5 - 1) % array_length(cl.values, 1)) + 1]
    ) AS prompt_text
  FROM target_dates td
  CROSS JOIN category_ids c
  CROSS JOIN openers o
  CROSS JOIN topics t
  CROSS JOIN closers cl
  WHERE COALESCE(array_length(c.ids, 1), 0) > 0
)
INSERT INTO prompts (category_id, prompt_text, is_active)
SELECT
  g.category_id,
  g.prompt_text,
  true
FROM generated g
WHERE NOT EXISTS (
  SELECT 1
  FROM prompts p
  WHERE p.prompt_text = g.prompt_text
);

WITH target_dates AS (
  SELECT
    gs::date AS prompt_date,
    ROW_NUMBER() OVER (ORDER BY gs::date) AS rn
  FROM generate_series(
      CURRENT_DATE,
      (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date,
      INTERVAL '1 day'
    ) AS gs
  WHERE NOT EXISTS (
    SELECT 1
    FROM daily_prompts dp
    WHERE dp.prompt_date = gs::date
  )
),
openers AS (
  SELECT ARRAY[
    'What felt most meaningful',
    'Share a moment from today when',
    'What is one thing you noticed about us when',
    'What conversation would you love to have about',
    'What surprised you recently about',
    'If we paused and reflected on',
    'What do you want me to understand better about',
    'What do you appreciate most when it comes to',
    'What would make you feel more supported around',
    'What has changed in the way you see'
  ]::TEXT[] AS values
),
topics AS (
  SELECT ARRAY[
    'our communication',
    'how we handle stress',
    'our routines',
    'our future together',
    'the way we celebrate wins',
    'our shared goals',
    'how we reconnect after busy days',
    'our quality time',
    'how we show care',
    'the little things we do'
  ]::TEXT[] AS values
),
closers AS (
  SELECT ARRAY[
    'and why?',
    'that made it stand out?',
    'that you want more of?',
    'that you want to improve together?',
    'that made you feel close to me?',
    'that you are most excited about next?',
    'that helped you feel understood?',
    'that felt especially kind?',
    'that made you smile?',
    'that you want us to remember?'
  ]::TEXT[] AS values
),
generated AS (
  SELECT
    td.prompt_date,
    format(
      '[Auto %s] %s %s %s',
      to_char(td.prompt_date, 'YYYY-MM-DD'),
      o.values[((td.rn - 1) % array_length(o.values, 1)) + 1],
      t.values[((td.rn * 3 - 1) % array_length(t.values, 1)) + 1],
      cl.values[((td.rn * 5 - 1) % array_length(cl.values, 1)) + 1]
    ) AS prompt_text
  FROM target_dates td
  CROSS JOIN openers o
  CROSS JOIN topics t
  CROSS JOIN closers cl
)
INSERT INTO daily_prompts (prompt_id, prompt_date)
SELECT
  p.id,
  g.prompt_date
FROM generated g
JOIN prompts p ON p.prompt_text = g.prompt_text
WHERE NOT EXISTS (
  SELECT 1
  FROM daily_prompts dp
  WHERE dp.prompt_date = g.prompt_date
)
ORDER BY g.prompt_date;
