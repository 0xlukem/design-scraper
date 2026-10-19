/** Chromium predicate shared by readiness, computed styles and CSS selection.
 * Geometry is clipped by ancestors, so hidden carousel slides are not required. */
export const captureRegionPredicate = String.raw`(element, height) => {
  const box = element.getBoundingClientRect();
  let left = Math.max(0, box.left), right = Math.min(1440, box.right);
  let top = Math.max(-scrollY, box.top), bottom = Math.min(height - scrollY, box.bottom);
  if (right <= left || bottom <= top) return false;
  for (let current = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (current === element || current === document.body || current === document.documentElement) continue;
    const parent = current.getBoundingClientRect();
    if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) { left = Math.max(left, parent.left); right = Math.min(right, parent.right); }
    if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) { top = Math.max(top, parent.top); bottom = Math.min(bottom, parent.bottom); }
    if (right <= left || bottom <= top) return false;
  }
  return true;
}`;
