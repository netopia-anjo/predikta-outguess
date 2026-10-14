import type { PublicRound } from '@/shared/types';

const readyImages = new Map<string, Promise<void>>();
function loadImage(url: string): Promise<void> {
  const cached = readyImages.get(url);
  if (cached) return cached;
  const ready = new Promise<void>((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('ad_image_unavailable')), 15_000);
    img.onload = () => img.decode().then(() => finish(), () => finish(new Error('ad_image_unavailable')));
    img.onerror = () => finish(new Error('ad_image_unavailable'));
    img.src = url;
  });
  readyImages.set(url, ready);
  void ready.catch(() => readyImages.delete(url));
  return ready;
}

/** Load/decode both creatives before asking the server to start a new round. */
export async function preloadRoundAds(round: PublicRound): Promise<void> {
  await Promise.all([round.a.image, round.b.image].filter((url): url is string => !!url).map(loadImage));
}
