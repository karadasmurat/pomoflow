/**
 * PomoFlow — Supabase client
 * Loaded via ESM CDN — no build step required.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = 'https://ejnkxrogljlbyxmxeasw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_egcVfsvz8irDIYPAWcbAdA_NBYHeAIC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
