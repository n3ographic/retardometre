import { appIcon } from '../lib/app-icon';

// Icônes du site et du manifeste : /icon/192 et /icon/512.
export const contentType = 'image/png';
export function generateImageMetadata() {
  return [192, 512].map((n) => ({ id: String(n), size: { width: n, height: n }, contentType }));
}

export default async function Icon({ id }: { id: Promise<string> | string }) {
  return appIcon(Number(await id));
}
