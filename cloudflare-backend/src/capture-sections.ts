// Bounded viewport photographs with reversible overlay normalization.
import type { Page } from "@cloudflare/playwright";
import { Buffer } from "node:buffer";
import { ApiError } from "./errors";

type Geometry = {scrollY:number;width:number;height:number;documentHeight:number};
export class SectionLayoutError extends ApiError {
  constructor(readonly geometry: {expected: Geometry; observed: Geometry}) {
    super("CAPTURE_LAYOUT_CHANGED", "The page layout changed during capture.", 422, true);
  }
}

export async function screenshotSections(page: Page, maxHeight: number, timeoutMs: number,
  beforeTile?: () => Promise<void>) {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new ApiError("SCRAPE_TIMEOUT", "Section capture deadline exceeded.", 504, true);
    return ms;
  };
  // Retries share the original time and byte budgets; no new browser or navigation.
  let bytes = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    remaining();
    try {
      return { ...await photograph(), attempts: attempt };
    } catch (error) {
      remaining();
      if (error instanceof SectionLayoutError && attempt === 1) {
        // A resize may arrive in several steps (for example, a lazy slot then
        // its content). Wait for a short stable height before spending the
        // only recomposition, still inside the original deadline.
        const settled = await page.evaluate(async maxMs => {
          const end = performance.now() + maxMs;
          let height = document.documentElement.scrollHeight, since = performance.now();
          while (performance.now() < end) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const current = document.documentElement.scrollHeight;
            if (current !== height) { height = current; since = performance.now(); }
            if (performance.now() - since >= 300) return true;
          }
          return false;
        }, Math.min(1500, remaining()));
        remaining();
        if (settled) continue;
      }
      throw error;
    }
  }
  throw new ApiError("CAPTURE_LAYOUT_CHANGED", "The page layout kept changing during capture.", 422, true);

  async function photograph() {
    const tiles: {scrollY:number;sourceY:number;outputY:number;height:number}[] = [];
    const frames: string[] = [];
    let outputY = 0, height = maxHeight;
    let documentHeight: number | undefined;
    const layoutChanged = (observed: Geometry, expected = observed) => new SectionLayoutError({
      expected: {...expected, documentHeight: documentHeight!}, observed,
    });
    const assertGeometry = async (expected: Geometry) => {
      remaining();
      const current = await page.evaluate(() => ({scrollY,width:innerWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight}));
      if (current.documentHeight !== documentHeight || current.scrollY !== expected.scrollY ||
          current.width !== expected.width || current.height !== expected.height) throw layoutChanged(current, expected);
    };
    // Keep element references and exact original inline attributes in the browser.
    // Sticky boxes retain their document-flow position; fixed overlays are painted
    // once, then made transparent without reflow. Source styles are restored even
    // when readiness or a photograph fails.
    const state = await page.evaluateHandle(() => ({
      originals:new Map<Element,string|null>(), fixed:new Set<Element>(),
      seen:new Set<Element>(), sticky:new Set<Element>(),
    }));
    try {
      while (outputY < height) {
        if (tiles.length >= 12) throw new Error("Section count limit exceeded");
        remaining();
        let geometry = await page.evaluate(async ({state,y}) => {
          for(const element of document.querySelectorAll<HTMLElement>('*')) {
            const position=getComputedStyle(element).position;
            if(!['fixed','sticky'].includes(position) || state.originals.has(element)) continue;
            state.originals.set(element,element.getAttribute('style'));
            if(position==='sticky') {
              state.sticky.add(element);
              element.style.setProperty('position','relative','important');
              for(const side of ['top','bottom','left','right']) element.style.setProperty(side,'auto','important');
            } else state.fixed.add(element);
          }
          for(const element of state.seen) (element as HTMLElement).style.setProperty('opacity','0','important');
          window.scrollTo({top:y,left:0,behavior:'instant'});
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          await new Promise(r=>setTimeout(r,150));
          return {scrollY,width:innerWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight};
        },{state,y:outputY===0?0:Math.max(0,outputY-100)});
        if (documentHeight !== undefined && geometry.documentHeight !== documentHeight) throw layoutChanged(geometry);
        if(geometry.width!==1440 || geometry.height!==900) throw new ApiError('CAPTURE_COMPOSITION_FAILED', 'Viewport changed during section capture.', 502, true);
        await beforeTile?.();
        if (documentHeight === undefined) {
          // Initial readiness can load fonts/images and resize the document.
          // Establish the baseline only when the first photograph is ready;
          // there are no tiles to discard yet.
          geometry = await page.evaluate(() => {
            window.scrollTo({top:0,left:0,behavior:'instant'});
            return {scrollY,width:innerWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight};
          });
          documentHeight = geometry.documentHeight;
          height = Math.min(maxHeight, documentHeight);
        }
        await assertGeometry(geometry);
        const sourceY=outputY-geometry.scrollY;
        const tileHeight=Math.min(height-outputY,geometry.height-sourceY);
        if(sourceY<0 || tileHeight<=0) throw new ApiError('CAPTURE_COMPOSITION_FAILED', 'Cannot advance section coverage.', 502, true);
        const frame=await page.screenshot({type:'jpeg',quality:85,fullPage:false,
          animations:'disabled',timeout:Math.min(5000,remaining())});
        bytes+=frame.byteLength;
        if(bytes>8000000) throw new ApiError('SCREENSHOT_TOO_LARGE', 'Section image byte budget exceeded.', 413);
        await assertGeometry(geometry);
        frames.push(Buffer.from(frame).toString('base64'));
        tiles.push({scrollY:geometry.scrollY,sourceY,outputY,height:tileHeight});
        await page.evaluate(({state,sourceY,tileHeight})=>{
          for(const element of state.fixed) {
            if(!element.isConnected || !element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
            const r=element.getBoundingClientRect();
            if(r.width>0 && r.height>0 && r.right>0 && r.left<innerWidth && r.bottom>sourceY && r.top<sourceY+tileHeight)
              state.seen.add(element);
          }
        },{state,sourceY,tileHeight});
        outputY+=tileHeight;
      }
      remaining();
      const encoded=await page.evaluate(async ({frames,tiles,height})=>{
        const canvas=document.createElement('canvas'); canvas.width=1440;canvas.height=height;
        const ctx=canvas.getContext('2d')!;
        for(let i=0;i<frames.length;i++) {
          const img=new Image();img.src='data:image/jpeg;base64,'+frames[i];await img.decode();
          const tile=tiles[i];ctx.drawImage(img,0,tile.sourceY,1440,tile.height,0,tile.outputY,1440,tile.height);
        }
        return canvas.toDataURL('image/jpeg',0.75).split(',')[1];
      },{frames,tiles,height});
      remaining();
      return {screenshot:Buffer.from(encoded,'base64'),tiles,height,documentHeight:documentHeight!};
    } finally {
      await page.evaluate(state=>{
        for(const [element,style] of state.originals) {
          if(style===null) element.removeAttribute('style');else element.setAttribute('style',style);
        }
        window.scrollTo({top:0,left:0,behavior:'instant'});
      },state).catch(()=>{});
      await state.dispose();
    }
  }
}
