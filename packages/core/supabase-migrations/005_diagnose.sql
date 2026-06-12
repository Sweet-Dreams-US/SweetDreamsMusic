-- DIAGNOSTIC: Find exactly what's breaking PostgREST schema cache
-- Run this in SQL Editor and send me ALL the output

-- 1. Check for broken views
SELECT schemaname, viewname, definition
FROM pg_views
WHERE schemaname = 'public'
AND NOT EXISTS (
  SELECT 1 FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname = viewname
);

-- 2. Check all triggers reference functions that exist
SELECT t.tgname AS trigger_name,
       c.relname AS table_name,
       p.proname AS function_name,
       CASE WHEN p.proname IS NULL THEN 'BROKEN - FUNCTION MISSING' ELSE 'OK' END AS status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_proc p ON t.tgfoid = p.oid
WHERE n.nspname IN ('public', 'auth')
AND NOT t.tgisinternal;

-- 3. Check all foreign keys are valid
SELECT
  tc.constraint_name,
  tc.table_schema || '.' || tc.table_name AS source_table,
  ccu.table_schema || '.' || ccu.table_name AS target_table,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = ccu.table_schema AND t.table_name = ccu.table_name
    ) THEN 'OK'
    ELSE 'BROKEN - TARGET TABLE MISSING'
  END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public';

-- 4. List all public tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 5. List all functions in public schema
SELECT proname, prosrc IS NOT NULL as has_body
FROM pg_proc
JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
WHERE nspname = 'public';

-- 6. Check PostgREST can read the schema right now
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb
FROM pg_roles
WHERE rolname IN ('authenticator', 'anon', 'authenticated', 'service_role', 'supabase_admin');

-- 7. Try the exact query PostgREST uses internally
SELECT EXISTS (
  SELECT 1 FROM pg_namespace WHERE nspname = 'public'
) AS public_schema_exists;

-- 8. Check for any invalid/broken objects
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY c.relkind, c.relname;
