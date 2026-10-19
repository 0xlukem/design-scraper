/** Explicit empty states for newly measured documents; historical exports stay stable. */
export function explainEmptySections(markdown: string): string {
  const lines = markdown.split('\n');
  const heading = (line: string) => /^#{2,3} /.test(line) || /^\*\*[^*]+\*\*$/.test(line);
  const level = (line: string) => line.startsWith('### ') ? 3 : line.startsWith('## ') ? 2 : 4;
  const result: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]; result.push(line);
    if (!heading(line)) continue;
    const block: string[] = [];
    let next = index + 1;
    for (; next < lines.length && !heading(lines[next]); next++) block.push(lines[next]);
    // A parent section is populated by its child sections, not necessarily prose.
    if (next < lines.length && heading(lines[next]) && level(lines[next]) > level(line)) continue;
    const meaningful = block.filter(x => x.trim() && !x.startsWith('| Name |') && !x.startsWith('| ---'));
    if (meaningful.length) continue;
    const name = line.replace(/^#+\s*|\*\*/g,'');
    const reason = /Touch targets|Layout changes|Image behavior/.test(name)
      ? 'Not verified at other viewport sizes or through interaction. Inspect these states before implementing responsive behavior.'
      : /Aspect ratios|Photography geometry/.test(name)
        ? 'No reliable reusable image geometry was documented. A screenshot alone does not establish cropping rules.'
        : 'No verified values were linked to this section. Consult the element measurements and Known Gaps; do not assume a default.';
    result.push('', `*${reason}*`);
  }
  return result.join('\n');
}
