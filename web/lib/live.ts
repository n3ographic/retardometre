import { round, toNum } from './num';
import type { Price } from './stats';

export type LiveStop = {
  seq: number; name?: string; lat?: number; lon?: number; arr?: string; dep?: string; delay_s?: number; cancelled?: true;
};
// Clés produites par public.live_trains() ; les valeurs nulles sont omises. `stops` : dernier arrêt portant
// un retard et le suivant (les deux premiers sans retard connu).
export type LiveTrain = {
  trip_id: string; service_date: string; brand: string; axis: string; train_number: string;
  cancelled: boolean; dep_planned: string; arr_planned: string; origin?: string; dest?: string;
  delay_s?: number; last_seq?: number; cause?: string; comp_pct: number; intl?: boolean;
  last_seen_at?: string; stops: LiveStop[];
};

export function shapeLive(trains: LiveTrain[], prices: Price[], now: Date) {
  return {
    generated_at: now.toISOString(),
    trains: trains.map((t) => {
      const price = prices.find((x) => x.brand === t.brand);
      if (!price) throw new Error(`prix de référence absent pour ${t.brand}`);
      const comp = (toNum(t.comp_pct, 'comp_pct') / 100) * toNum(price.price_eur_ht, 'price_eur_ht');
      return { ...t, comp_eur_per_passenger_ref: round(comp, 2) };
    }),
  };
}
