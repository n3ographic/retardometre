import { notFound } from 'next/navigation';
import { weekCard } from './card';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Bilan hebdomadaire des TGV : régularité, indemnités théoriques et train de la semaine';

export default async function Image({ params }: { params: Promise<{ semaine: string }> }) {
  return (await weekCard((await params).semaine, size)) ?? notFound();
}
