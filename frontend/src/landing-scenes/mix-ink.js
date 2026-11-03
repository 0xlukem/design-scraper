import * as THREE from 'three';

const NS='http://www.w3.org/2000/svg';
const COLORS=['#f24cad','#edff7a','#287df1'];
const FIRST=250,PERIOD=1300,FLIGHT=750,SLOTS=32,GROW=340;
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t)};
const seeded=n=>{let x=(n+1)*1597334677>>>0;return()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296}};
const svgNode=(tag,attributes={})=>{const node=document.createElementNS(NS,tag);Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,String(value)));return node};
const overlaps=(a,b,pad=0)=>a.x<b.x+b.width+pad&&a.x+a.width>b.x-pad&&a.y<b.y+b.height+pad&&a.y+a.height>b.y-pad;

function splatter(index,color){
  const random=seeded(index+45),points=[];
  for(let i=0;i<16;i++){const angle=i*Math.PI/8+(random()-.5)*.24,radius=.48+random()*.84;points.push([Math.cos(angle)*radius,Math.sin(angle)*radius])}
  const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const first=mid(points.at(-1),points[0]);let path=`M${first.join(' ')}`;
  points.forEach((point,i)=>{path+=`Q${point.join(' ')} ${mid(point,points[(i+1)%points.length]).join(' ')}`});path+='Z';
  let body=`<path d="${path}"/>`;
  for(let i=0;i<9;i++){const angle=random()*Math.PI*2,r=1.12+random()*.43;body+=`<circle cx="${Math.cos(angle)*r}" cy="${Math.sin(angle)*r}" r="${.025+random()*.065}"/>`}
  const drip=.87+random()*.55;
  body+=`<path d="M.30 .49 Q.45 .85 .34 ${drip} Q.28 ${drip+.10} .23 ${drip} Q.28 .87 .15 .53Z"/><path d="M-.37 .40 Q-.27 .87 -.33 1.10 Q-.39 1.20 -.43 1.09 Q-.36 .79 -.48 .45Z"/>`;
  return {body,uri:`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="${NS}" viewBox="-1.6 -1.6 3.2 3.2"><g fill="${color}">${body}</g></svg>`)}")`};
}

export function createMixInk({banner,host,camera,rig}){
  const title=banner.querySelector('#mix-title');
  const originalMarkup=title.innerHTML;
  const original=[...title.childNodes];const letters=[];
  title.setAttribute('aria-label','Go for your own way.');
  for(const node of original){
    if(node.nodeType!==Node.TEXT_NODE)continue;
    const fragment=document.createDocumentFragment();
    for(const part of node.textContent.split(/(\s+)/)){
      if(!part)continue;
      if(/^\s+$/.test(part)){fragment.append(document.createTextNode(part));continue}
      const word=document.createElement('span');word.className='mix-word';word.setAttribute('aria-hidden','true');
      for(const character of part){const glyph=document.createElement('span');glyph.className='mix-letter';glyph.textContent=character;word.append(glyph);letters.push({node:glyph,character,marks:[],box:null,dirty:true,active:false})}
      fragment.append(word);
    }
    node.replaceWith(fragment);
  }
  const wall=svgNode('svg',{'aria-hidden':'true'});wall.classList.add('mix-stains');banner.append(wall);
  const air=svgNode('svg',{'aria-hidden':'true'});air.classList.add('mix-ink-air');banner.append(air);
  const packet=svgNode('path',{d:'M-17 -3 Q-9 -7 3 -5 Q12 -4 12 0 Q12 6 3 5 Q-10 4 -17 -3Z'});air.append(packet);
  let box,hostBox,modelBox,keepouts=[],candidates=[],slots=[],marks=new Map(),lastTime=-1,layout=0;
  const relative=rect=>({x:rect.left-box.left,y:rect.top-box.top,width:rect.width,height:rect.height});
  function resize(){
    box=banner.getBoundingClientRect();hostBox=host.getBoundingClientRect();layout++;
    wall.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);air.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
    letters.forEach(letter=>{const transform=letter.node.style.transform;letter.node.style.transform='none';letter.box=relative(letter.node.getBoundingClientRect());letter.node.style.transform=transform;letter.font=parseFloat(getComputedStyle(letter.node).fontSize);letter.dirty=true});
    candidates=letters.filter(letter=>/[a-z]/i.test(letter.character)&&letter.box.width>letter.font*.21);
    rig.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(rig),xs=[],ys=[];
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      const point=new THREE.Vector3(x,y,z).project(camera);xs.push(hostBox.left-box.left+(point.x+1)*hostBox.width/2);ys.push(hostBox.top-box.top+(1-point.y)*hostBox.height/2);
    }
    modelBox={x:Math.min(...xs)-10,y:Math.min(...ys)-10,width:Math.max(...xs)-Math.min(...xs)+20,height:Math.max(...ys)-Math.min(...ys)+20};
    keepouts=[relative(title.getBoundingClientRect()),...['.mix-wordmark','.mix-description','.mix-actions'].map(selector=>relative(banner.querySelector(selector).getBoundingClientRect())),modelBox];
    slots=Array.from({length:SLOTS},(_,i)=>{
      const random=seeded(i+203),background=i%3===2,color=COLORS[(i+Math.floor(i/3))%COLORS.length],shape=splatter(i,color);
      if(!background){const letter=candidates[((i-Math.floor(i/3))*7)%candidates.length];return {i,background,color,shape,letter,u:.28+random()*.44,v:.32+random()*.31,r:.17+random()*.075}}
      const radius=box.width<760?14+random()*8:28+random()*25;
      let point={x:box.width*.93,y:box.height*.91};
      for(let attempt=0;attempt<100;attempt++){
        const edge=box.width<760&&attempt<8;
        const trial=edge?{x:(i+attempt)%2?radius*.18:box.width-radius*.18,y:box.height*(.30+random()*.46)}:{x:radius*1.55+random()*(box.width-radius*3.1),y:radius*1.55+random()*(box.height-radius*3.1)};
        const area={x:trial.x-radius*1.5,y:trial.y-radius*1.5,width:radius*3,height:radius*3};
        if(!keepouts.some(zone=>overlaps(area,zone,8))){point=trial;break}
      }
      return {i,background,color,shape,x:point.x/box.width,y:point.y/box.height,r:radius/box.width};
    });
    for(const [i,mark] of marks){const fresh=slots[i];Object.assign(mark,fresh);mark.done=false;if(mark.background){mark.node.innerHTML=mark.shape.body;mark.node.setAttribute('fill',mark.color)}else mark.letter.dirty=true}
  }
  function target(slot){
    if(slot.background)return {x:slot.x*box.width,y:slot.y*box.height};
    const b=slot.letter.box;return {x:b.x+b.width*slot.u,y:b.y+b.height*slot.v};
  }
  function reset(){
    marks.clear();wall.replaceChildren();packet.style.visibility='hidden';lastTime=-1;
    letters.forEach(letter=>{letter.marks=[];letter.node.classList.remove('is-inked');letter.node.style.backgroundImage='';letter.node.style.backgroundPosition='';letter.node.style.backgroundSize='';letter.node.style.transform='';letter.node.style.willChange='';letter.active=false;letter.dirty=true});
  }
  function render(ms,source,{still=false}={}){
    if(ms<lastTime-5)reset();lastTime=ms;
    const from={x:hostBox.left-box.left+(source.x+1)*hostBox.width/2,y:hostBox.top-box.top+(1-source.y)*hostBox.height/2};
    // Pigment survives the master-loop boundary. Replay is the only clean slate.
    for(let i=0;i<SLOTS;i++){
      const born=FIRST+i*PERIOD+FLIGHT;if(ms<born||marks.has(i))continue;
      const slot=slots[i],mark={...slot,born,done:false};
      if(slot.background){mark.node=svgNode('g',{fill:slot.color,opacity:.74});mark.node.innerHTML=slot.shape.body;wall.append(mark.node)}
      else{slot.letter.marks.push(mark);slot.letter.dirty=true;slot.letter.node.classList.add('is-inked');slot.letter.node.style.backgroundImage=slot.letter.marks.map(item=>item.shape.uri).reverse().join(',')}
      marks.set(i,mark);
    }
    const shot=Math.floor((ms-FIRST)/PERIOD),launch=FIRST+shot*PERIOD,age=ms-launch;
    const current=shot>=0?slots[shot%SLOTS]:null;
    if(current&&age>=0&&age<FLIGHT&&!still){
      const to=target(current),t=age/FLIGHT,control={x:(from.x+to.x)/2+35,y:Math.min(from.y,to.y)-Math.min(110,box.height*.15)};
      const x=(1-t)**2*from.x+2*(1-t)*t*control.x+t*t*to.x,y=(1-t)**2*from.y+2*(1-t)*t*control.y+t*t*to.y;
      const dx=2*(1-t)*(control.x-from.x)+2*t*(to.x-control.x),dy=2*(1-t)*(control.y-from.y)+2*t*(to.y-control.y);
      packet.style.visibility='visible';packet.setAttribute('fill',current.color);packet.setAttribute('transform',`translate(${x} ${y}) rotate(${Math.atan2(dy,dx)*180/Math.PI}) scale(${box.width<760?.65:1})`);
    }else packet.style.visibility='hidden';
    for(const mark of marks.values()){
      const growth=still?1:clamp((ms-mark.born)/GROW),scale=growth<.8?1.06*smooth(growth/.8):1.06-.06*smooth((growth-.8)/.2);
      if(mark.background&&!mark.done){const p=target(mark);mark.node.setAttribute('transform',`translate(${p.x} ${p.y}) scale(${mark.r*box.width*scale})`);if(growth===1)mark.done=true}
      if(!mark.background&&growth<1)mark.letter.dirty=true;
    }
    const impactTime=launch+FLIGHT,hitAge=ms-impactTime;
    const hit=current&&!current.background&&hitAge>=0&&hitAge<600&&!still?current.letter:null;
    letters.forEach((letter,index)=>{
      if(letter.dirty){
        letter.node.style.backgroundSize=letter.marks.map(mark=>{const p=still?1:clamp((ms-mark.born)/GROW),scale=p<.8?1.06*smooth(p/.8):1.06-.06*smooth((p-.8)/.2);return `${3.2*mark.r*letter.font*scale}px ${3.2*mark.r*letter.font*scale}px`}).reverse().join(',');
        letter.node.style.backgroundPosition=letter.marks.map(mark=>{const p=still?1:clamp((ms-mark.born)/GROW),scale=p<.8?1.06*smooth(p/.8):1.06-.06*smooth((p-.8)/.2),half=1.6*mark.r*letter.font*scale;return `${letter.box.width*mark.u-half}px ${letter.box.height*mark.v-half}px`}).reverse().join(',');
        letter.dirty=letter.marks.some(mark=>ms-mark.born<GROW);
      }
      let response=0;
      if(hit){const distance=Math.abs(letters.indexOf(hit)-index);if(distance<=1){const t=hitAge-distance*45;response=(t<90?smooth(t/90):1-smooth((t-90)/430))*(distance?.28:1)}}
      if(response>.0001){const dir=target(current).x<from.x?-1:1;letter.node.style.willChange='transform';letter.node.style.transform=`translate(${dir*letter.font*.065*response}px,${-letter.font*.04*response}px) rotate(${dir*4.5*response}deg) scale(${1+.025*response},${1-.06*response})`;letter.active=true}
      else if(letter.active){letter.node.style.transform='';letter.node.style.willChange='';letter.active=false}
    });
    banner.dataset.inkMarks=String(marks.size);banner.dataset.inkLetters=String(letters.filter(letter=>letter.marks.length).length);banner.dataset.inkBackground=String([...marks.values()].filter(mark=>mark.background).length);
  }
  resize();
  return {resize,render,reset,dispose(){wall.remove();air.remove();title.innerHTML=originalMarkup;title.removeAttribute('aria-label')}};
}
