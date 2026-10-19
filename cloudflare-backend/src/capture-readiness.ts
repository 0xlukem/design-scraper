import { captureRegionPredicate } from "./capture-region";
export const captureReadiness = String.raw`async ({ height, waitMs, viewportOnly = false }) => {
  const inRegion = element => {
    if (!((${captureRegionPredicate})(element, height))) return false;
    const box = element.getBoundingClientRect();
    return !viewportOnly || (box.bottom > 0 && box.top < innerHeight);
  };
  const start = Date.now();
  let stable = 0;
  while (Date.now() - start < waitMs) {
    const images = [...document.images].filter(inRegion);
    const pending = images.filter(image => !image.complete);
    if (document.fonts.status === 'loaded' && !pending.length) {
      if (++stable >= 3) break;
    } else stable = 0;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const images = [...document.images].filter(inRegion);
  const posters = [...document.querySelectorAll('video[poster]')]
    .filter(video => video.getAttribute('poster')?.trim() && inRegion(video))
    .map(video => video.poster);
  const imageUrls = [...new Set([...images.map(image => image.currentSrc || image.src), ...posters])];
  const backgrounds = [];
  for (const element of [...document.querySelectorAll('*')].filter(inRegion)) {
    for (const pseudo of [null, '::before', '::after']) {
      const style = getComputedStyle(element, pseudo);
      if (pseudo && (style.content === 'none' || Number(style.opacity) === 0)) continue;
      for (const match of style.backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)) backgrounds.push(match[1]);
    }
  }
  return { fontsLoaded: document.fonts.status === 'loaded',
    pending: images.filter(image => !image.complete || !image.naturalWidth).length,
    outside: [...document.images].filter(image => !((${captureRegionPredicate})(image, height))).length,
    imageUrls,
    backgroundUrls: [...new Set(backgrounds)],
    required: [...new Set([...imageUrls, ...backgrounds])] };
}`;
