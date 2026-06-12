-- Single combined diagnostic - run this in SQL Editor
SELECT 'TRIGGER' AS check_type,
       t.tgname AS name,
       c.relname AS related_to,
       COALESCE(p.proname, 'MISSING_FUNCTION') AS detail
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_proc p ON t.tgfoid = p.oid
WHERE n.nspname = 'public'
AND NOT t.tgisinternal

UNION ALL

SELECT 'RLS_POLICY' AS check_type,
       pol.polname AS name,
       c.relname AS related_to,
       pg_get_expr(pol.polqual, pol.polrelid) AS detail
FROM pg_policy pol
JOIN pg_class c ON pol.polrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'

UNION ALL

SELECT 'FUNCTION' AS check_type,
       p.proname AS name,
       n.nspname AS related_to,
       '' AS detail
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'

ORDER BY check_type, name;
