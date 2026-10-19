import { it, expect } from 'vitest';
import { cssLikeColor } from '../src/domain/css-color';
import { normalize, type Source } from '../src/domain/normalize';
import fixtures from './fixtures/contracts.json';
const gradient='linear-gradient(180deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0))';
it.each([gradient,'color-mix(in srgb, rgb(1, 2, 3), #fff)','rgb(calc(10 + 2) 20 30)','linear-gradient(#fff, var(--brand))'])('accepts balanced CSS color functions: %s', value=>expect(cssLikeColor(value)).toBe(true));
it.each(['linear-gradient(rgb(1,2,3), #fff','rgb(1,2,3));color:red','rgb(url(https://example.com))','rgb(alert(1))','rgb(1,2,3)<style>','rgb(1,2,3)\n','rgb("red")'])('rejects unsafe or unbalanced values: %s', value=>expect(cssLikeColor(value)).toBe(false));
it('preserves an actual Bootstrap gradient byte-for-byte during normalization',()=>{
 const f=fixtures[0];
 const raw={...f.raw,colors:{...f.raw.colors,gradients:[{...f.raw.colors.brand[0],value:gradient}]}};
 expect(normalize(JSON.stringify(raw),f.sources as Source[]).colors.gradients[0].value).toBe(gradient);
});
