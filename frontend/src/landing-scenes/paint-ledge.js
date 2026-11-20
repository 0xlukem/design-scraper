// Paint pinned to the upper lip of the banner. Each incoming load adds volume
// at its landing point; once the lip fills, excess feeds the hanging beads.
export function createLedgePool(node, color, random) {
  const group = node('g', { 'data-region': 'ledge-pool' });
  const body = node('path', { fill: color, 'data-region': 'banner' });
  const runs = node('path', { fill: color });
  const shine = node('path', {
    fill: 'none', stroke: 'white', 'stroke-linecap': 'round', 'stroke-width': 1.25,
  });
  group.append(body, runs, shine);
  const positions = random() < .5 ? [-.33, .45] : [-.49, .06, .53];
  const outlets = positions.map((position, i) => ({
    position: position + (random() - .5) * .14,
    threshold: [1.25, .45, 2.1][i] + random() * .35,
    width: 1.45 + random() * 1.7,
    reach: 10 + random() * 23,
    drift: (random() - .5) * 4,
    length: 0,
  }));
  let volume = 0, spread = 0, wetness = 0, center = 0, settled = false;

  function add(offset, load) {
    center += (offset - center) * load / (volume + load);
    volume = Math.min(7, volume + load);
    wetness = 1;
    settled = false;
  }

  function draw(dt) {
    if (settled || !volume) return;
    const response = 1 - Math.exp(-dt * 5);
    spread += (volume - spread) * response;
    wetness = Math.max(0, wetness - dt / 6);
    const half = 24 * Math.sqrt(spread);
    const depth = 2.8 * Math.sqrt(spread);
    // A low asymmetric mound above the seam, with a thin meniscus below it.
    const shape = `M ${-half} 0 C ${-half * .84} ${-depth * .32} ${-half * .51} ${-depth * 1.3} ${-half * .17} ${-depth}
      S ${half * .54} ${-depth * .65} ${half} 0 Q ${half * .38} ${depth * .73} 0 ${depth * .51} T ${-half} 0 Z`;
    let trails = '', glints = '';
    let flowing = false;
    for (const outlet of outlets) {
      const excess = Math.max(0, spread - outlet.threshold);
      const target = outlet.reach * (1 - Math.exp(-excess * .82));
      outlet.length += (target - outlet.length) * (1 - Math.exp(-dt * .96));
      if (target - outlet.length > .08) flowing = true;
      const y = outlet.length;
      if (y < .15) continue;
      const x = outlet.position * half;
      const neck = outlet.width * Math.min(1, y / 6);
      const tip = neck * 1.55, drift = outlet.drift * Math.min(1, y / 8);
      const tipX = x + drift;
      trails += ` M ${x - neck * 2.8} 0 Q ${x - neck} 1 ${x - neck} ${y * .32}
        C ${x - neck} ${y * .66} ${tipX - tip} ${y * .83} ${tipX - tip} ${y}
        C ${tipX - tip} ${y + tip * 1.4} ${tipX + tip} ${y + tip * 1.4} ${tipX + tip} ${y}
        C ${tipX + tip} ${y * .8} ${x + neck * .85} ${y * .64} ${x + neck} ${y * .3}
        Q ${x + neck} 1 ${x + neck * 2.8} 0 Z`;
      if (y > 4) glints += ` M ${tipX - tip * .45} ${y - 1} q -.6 1.1 0 2`;
    }
    body.setAttribute('d', shape);
    runs.setAttribute('d', trails);
    shine.setAttribute('d', `M ${-half * .65} ${-depth * .51} q ${half * .14} ${-depth * .42} ${half * .28} ${-depth * .4}${glints}`);
    shine.setAttribute('opacity', String(.07 + wetness * .28));
    body.setAttribute('transform', `translate(${center} 0)`);
    runs.setAttribute('transform', `translate(${center} 0)`);
    shine.setAttribute('transform', `translate(${center} 0)`);
    settled = wetness === 0 && Math.abs(volume - spread) < .001 && !flowing;
  }
  return { group, add, draw };
}
