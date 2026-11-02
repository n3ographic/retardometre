import { notFound, redirect } from 'next/navigation';
import { loadWeeks } from '../../lib/handlers';
import { supabaseDeps } from '../../lib/supabase';

export const dynamic = 'force-dynamic';

// /semaine : dernière semaine complète calculée.
export default async function Page() {
  const weeks = await loadWeeks(supabaseDeps).catch(() => []);
  if (weeks.length === 0) notFound();
  redirect(`/semaine/${weeks[weeks.length - 1]}`);
}
