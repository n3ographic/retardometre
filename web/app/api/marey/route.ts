import { createMareyHandler } from '../../../lib/handlers';
import { supabaseDeps } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'cdg1'; // Supabase en eu-west-3 (Paris)
export const GET = createMareyHandler(supabaseDeps);
