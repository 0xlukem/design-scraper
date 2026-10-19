import { build } from "esbuild";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const file = process.argv[2];
if (!file) throw new Error("Pass a saved capture-check JSON. This invokes Gemini once; no Browser Run call.");
const dir = await mkdtemp(join(tmpdir(), "design-scraper-replay-"));
try {
  await build({stdin:{contents:`export {analyze} from './src/providers'; export {config} from './src/config'; export {normalize} from './src/domain/normalize'; export {renderDocuments,renderExports} from './src/domain/renderers';`,resolveDir:process.cwd()},outfile:join(dir,"domain.mjs"),bundle:true,format:"esm",platform:"node",logLevel:"silent"});
  const {analyze,config,normalize,renderDocuments,renderExports}=await import(pathToFileURL(join(dir,"domain.mjs")));
  const key=(await readFile('.dev.vars','utf8')).split(/\r?\n/).find(s=>s.startsWith('GEMINI_API_KEY='))?.slice('GEMINI_API_KEY='.length).trim();
  if (!key) throw new Error('Project Gemini credential unavailable');
  const captured=JSON.parse(await readFile(file,'utf8'));
  const index=Number(process.argv[3] ?? 0);
  const sources=[{...captured.sources[index],label:'web_1',weight:100}];
  const env={GEMINI_API_KEY:key,GEMINI_MODEL:'gemini-3.6-flash',MAX_AI_ATTEMPTS:'1',AI_INPUT_PRICE_USD_PER_MILLION:'0.75',AI_OUTPUT_PRICE_USD_PER_MILLION:'3.75'};
  const stamp=Date.now(), started=Date.now();
  await mkdir('reports',{recursive:true});
  const measuredFetch=async (...args)=>{
    const r=await fetch(...args); const p=await r.clone().json();
    await writeFile(`reports/replay-provider-${stamp}.json`,JSON.stringify({status:r.status,candidates:p.candidates,usage:p.usageMetadata},null,2));
    return r;
  };
  try {
    const r=await analyze(sources,env,config(env),AbortSignal.timeout(110000),measuredFetch);
    await writeFile(`reports/replay-raw-${stamp}.json`,r.raw);
    const system=normalize(r.raw,sources),documents=renderDocuments(system),exports=renderExports(system);
    await writeFile(`reports/replay-result-${stamp}.json`,JSON.stringify({success:true,design_system:system,design_md:documents.extended,documents,exports,metadata:{usage:r.usage}},null,2));
    console.log(JSON.stringify({kind:'saved-capture-replay',success:true,wall_ms:Date.now()-started,usage:r.usage,result:`reports/replay-result-${stamp}.json`}));
  }catch(e){console.log(JSON.stringify({kind:'saved-capture-replay',success:false,wall_ms:Date.now()-started,code:e.code,validation_reason:e.validationReason??null,diagnostic:e.diagnostic??null}));process.exitCode=1;}
} finally { await rm(dir,{recursive:true,force:true}); }
