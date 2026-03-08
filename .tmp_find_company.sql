SELECT id, name, created_at
FROM public.companies
WHERE name ILIKE '%экспресс%'
   OR name ILIKE '%полив%'
   OR name ILIKE '%express%'
ORDER BY created_at DESC
LIMIT 50;
