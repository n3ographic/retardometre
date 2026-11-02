import { weekCard } from '../card';

// Image carrée 1080×1080 à télécharger pour les réseaux sociaux.
export async function GET(_req: Request, { params }: { params: Promise<{ semaine: string }> }) {
  return (await weekCard((await params).semaine, { width: 1080, height: 1080 })) ?? new Response('semaine inconnue', { status: 404 });
}
