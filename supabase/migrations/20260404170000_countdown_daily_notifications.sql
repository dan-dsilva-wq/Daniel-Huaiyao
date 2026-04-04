ALTER TABLE important_dates
  ALTER COLUMN notify_days_before SET DEFAULT '{0,1,2,3,4,5,6,7}';

UPDATE important_dates
SET notify_days_before = '{0,1,2,3,4,5,6,7}'
WHERE notify_days_before IS NULL
   OR notify_days_before = '{1,7}';
