-- ADR 0016: five types replace the seven categories. Stored labels move to their type so no
-- classified email loses its place; the column keeps its name (ADR 0014 allow-list).
-- This file is the only place the retired names appear.
UPDATE message SET category = CASE category
  WHEN 'people' THEN 'personal'
  WHEN 'records' THEN 'transactional'
  WHEN 'purchases-travel' THEN 'transactional'
  WHEN 'sign-ins-security' THEN 'transactional'
  WHEN 'notifications' THEN 'notification'
  WHEN 'newsletters' THEN 'newsletter'
  WHEN 'promotions' THEN 'promotion'
  ELSE category END;
UPDATE derived SET category = CASE category
  WHEN 'people' THEN 'personal'
  WHEN 'records' THEN 'transactional'
  WHEN 'purchases-travel' THEN 'transactional'
  WHEN 'sign-ins-security' THEN 'transactional'
  WHEN 'notifications' THEN 'notification'
  WHEN 'newsletters' THEN 'newsletter'
  WHEN 'promotions' THEN 'promotion'
  ELSE category END;
