import { captureRegionPredicate } from "./capture-region";
export const captureReadiness = String.raw`async ({ height, waitMs, viewportOnly = false, localFonts = false, pendingStylesheets = null }) => {
  const inRegion = element => {
    if (!((${captureRegionPredicate})(element, height))) return false;
    const box = element.getBoundingClientRect();
    return !viewportOnly || (box.bottom > 0 && box.top < innerHeight);
  };
  const fontsReady = () => !localFonts ? document.fonts.status === 'loaded' :
    [...document.querySelectorAll('h1,h2,h3,p,li,a,button,input')].filter(inRegion).every(element => {
      const css = getComputedStyle(element);
      return document.fonts.check(css.font || (css.fontSize + ' ' + css.fontFamily), (element.textContent || 'BESbswy').slice(0, 32));
    });
  const start = Date.now();
  let stable = 0;
  while (Date.now() - start < waitMs) {
    const images = [...document.images].filter(inRegion);
    const pending = images.filter(image => !image.complete);
    if (fontsReady() && !pending.length) {
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
  // A dynamically inserted sheet may still be in flight at DOMContentLoaded.
  // Imports have their own stylesheet requests without an equivalent link node.
  const links = pendingStylesheets === null ? [] : [...document.querySelectorAll('link[rel~="stylesheet" i][href]')];
  const activeLinks = links.filter(link => !link.disabled && (!link.media || matchMedia(link.media).matches));
  const inactiveUrls = new Set(links.map(link => link.href));
  for (const link of activeLinks) inactiveUrls.delete(link.href);
  const stylesLoaded = pendingStylesheets === null || (activeLinks.every(link => link.sheet) &&
    pendingStylesheets.every(url => inactiveUrls.has(url)));
  return { fontsLoaded: fontsReady(), stylesLoaded,
    pending: images.filter(image => !image.complete || !image.naturalWidth).length,
    outside: [...document.images].filter(image => !((${captureRegionPredicate})(image, height))).length,
    imageUrls,
    backgroundUrls: [...new Set(backgrounds)],
    required: [...new Set([...imageUrls, ...backgrounds])] };
}`;
