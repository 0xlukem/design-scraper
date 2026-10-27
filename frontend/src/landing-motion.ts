import { gsap } from 'gsap'

/** Illustrates a saved capture. Never dispatches an analysis. */
export function initLandingMotion() {
  const q = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
  const scene = q('.scene'), canvas = q('.canvas');
  const source = q('.source-window');
  const pieces = [...document.querySelectorAll('.piece')];
  const heading = q('.output-heading'), closing = q('.export-line');
  const play = q<HTMLButtonElement>('#play'), replay = q<HTMLButtonElement>('#replay'), scrub = q<HTMLInputElement>('#scrub');
  const stages = [...document.querySelectorAll<HTMLButtonElement>('[data-time]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const isReduced = () => reduced.matches;
  let timeline: gsap.core.Timeline, userPaused = false, inView = false;
  let resizeTimer: ReturnType<typeof setTimeout>;
  const duration = 12;

  function controls() {
    if (!timeline) return;
    const t = timeline.time();
    scrub.value = String(Math.round(t / duration * 1000));
    scrub.setAttribute('aria-valuetext', `${Math.round(t)} of ${duration} seconds`);
    const phase = t < 2.2 ? 0 : t < 8.1 ? 1 : 2;
    stages.forEach((b, i) => b.setAttribute('aria-pressed', String(i === phase)));
    const paused = timeline.paused() || t >= duration;
    play.textContent = isReduced() ? 'Motion reduced' : paused ? 'Play ▷' : 'Pause Ⅱ';
    play.setAttribute('aria-label', isReduced() ? 'Motion is reduced' : paused ? 'Play animation' : 'Pause animation');
    play.disabled = isReduced();
    replay.disabled = isReduced();
  }

  function build() {
    if (!scene.clientWidth) return;
    const previous = timeline?.time() ?? 0;
    const wasPlaying = timeline && !timeline.paused();
    timeline?.kill();
    const mobile = window.innerWidth <= 760;
    const baseW = mobile ? 360 : 1000;
    const baseH = mobile ? 640 : 320;
    const scale = scene.clientWidth / baseW;
    scene.dataset.motionReady = '';
    q('.motion-controls').dataset.ready = '';
    scene.style.minHeight = '0';
    scene.style.height = `${baseH * scale}px`;
    canvas.style.width = `${baseW}px`;
    canvas.style.height = `${baseH}px`;
    canvas.style.transform = `scale(${scale})`;
    const origin = mobile ? {x:14,y:70,w:332,h:232} : {x:290,y:15,w:420,h:293};
    const dest = mobile ? [
      {x:16,y:90,w:148,h:245}, {x:180,y:90,w:164,h:245},
      {x:16,y:355,w:148,h:190}, {x:180,y:355,w:164,h:190},
    ] : [
      {x:30,y:65,w:230,h:210}, {x:280,y:65,w:220,h:210},
      {x:520,y:65,w:190,h:210}, {x:730,y:65,w:240,h:210},
    ];
    gsap.set([source, ...pieces, heading, closing, '.selection', '.scan-line'], {clearProps:'transform,opacity,visibility'});
    gsap.set(source, {left:0,top:0,x:origin.x,y:origin.y,width:origin.w,height:origin.h});
    gsap.set(heading, {left:mobile?16:30,top:mobile?48:30,width:mobile?328:940});
    gsap.set(closing, {left:mobile?16:30,top:mobile?578:290,width:mobile?328:940,height:mobile?35:25});
    pieces.forEach((piece,i) => gsap.set(piece, {left:0,top:0,x:dest[i].x,y:dest[i].y,width:dest[i].w,height:dest[i].h}));
    const start = [
      {x:origin.x+origin.w*.30,y:origin.y+origin.h*.22},
      {x:origin.x+origin.w*.58,y:origin.y+origin.h*.42},
      {x:origin.x+origin.w*.45,y:origin.y+origin.h*.60},
      {x:origin.x+origin.w*.32,y:origin.y+origin.h*.47},
    ];
    const scatter = mobile ? [
      {x:8,y:60,r:-9},{x:175,y:110,r:9},{x:18,y:345,r:-6},{x:178,y:380,r:6},
    ] : [
      {x:5,y:30,r:-8},{x:286,y:50,r:8},{x:505,y:85,r:-7},{x:758,y:40,r:7},
    ];
    timeline = gsap.timeline({paused:true,onUpdate:controls,onComplete:controls});
    timeline.set([heading,closing,...pieces],{autoAlpha:0},0)
      .set(['.selection','.scan-line'],{autoAlpha:0},0)
      .set(source,{autoAlpha:1,scale:1,rotation:0},0)
      .fromTo(source,{y:origin.y+12},{y:origin.y,duration:.7,ease:'power2.out'},0)
      .set('.scan-line',{autoAlpha:1,scaleX:1,y:0},1.15)
      .to('.scan-line',{y:origin.h-40,duration:2.25,ease:'none'},1.15)
      .to('.selection-type',{autoAlpha:1,duration:.15},1.8)
      .to('.selection-button',{autoAlpha:1,duration:.15},2.5)
      .to('.scan-line',{autoAlpha:0,duration:.2},3.4)
      .to('.selection',{autoAlpha:0,duration:.2},3.7)
      .to(source,{scale:.78,rotation:-3,autoAlpha:0,duration:1.35,ease:'power2.inOut'},4.1);
    pieces.forEach((piece,i) => {
      const launch = 3.5 + i*.32;
      timeline.fromTo(piece,
        {x:start[i].x,y:start[i].y,scale:.12,rotation:0,autoAlpha:0},
        {x:scatter[i].x,y:scatter[i].y,scale:1,rotation:scatter[i].r,autoAlpha:1,duration:1.65,ease:'power3.out'},launch)
        .to(piece,{x:dest[i].x,y:dest[i].y,rotation:0,duration:1.15,ease:'power3.inOut'},6.5+i*.12);
    });
    timeline.to(heading,{autoAlpha:1,duration:.5},7.5)
      .to(closing,{autoAlpha:1,duration:.5},8.1)
      .to({}, {duration:3.4},8.6);
    timeline.seek(isReduced() ? duration : previous, false);
    if (!isReduced() && !userPaused && (wasPlaying || inView) && !document.hidden && previous < duration) timeline.play();
    controls();
  }

  play.addEventListener('click', () => {
    if (timeline.paused() || timeline.time() >= duration) {
      userPaused = false;
      timeline.time() >= duration ? timeline.restart() : timeline.play();
    } else { userPaused = true; timeline.pause(); }
    controls();
  });
  replay.addEventListener('click', () => {userPaused=false;timeline.restart();controls();});
  scrub.addEventListener('input', () => {userPaused=true;timeline.pause().seek(Number(scrub.value)/1000*duration,false);controls();});
  stages.forEach(button => button.addEventListener('click', () => {
    userPaused=true;
    timeline.pause().seek(Number(button.dataset.time),false);
    controls();
  }));
  const observer = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (!inView) timeline?.pause();
    else if (!isReduced() && !userPaused && !document.hidden && timeline?.time() < duration) timeline.play();
    controls();
  },{threshold:.12});
  document.querySelector('.hero-demo')?.addEventListener('toggle', () => {
    if ((document.querySelector('.hero-demo') as HTMLDetailsElement).open) build();
    else { timeline?.pause(); controls(); }
  });
  build();
  observer.observe(scene);
  document.addEventListener('visibilitychange', () => {
    if(document.hidden) timeline?.pause();
    else if(inView && !userPaused && !isReduced() && timeline?.time()<duration) timeline.play();
    controls();
  });
  window.addEventListener('resize', () => {clearTimeout(resizeTimer);resizeTimer=setTimeout(build,100);});
  reduced.addEventListener('change',build);
  window.addEventListener('pagehide', event => {
    timeline?.pause(); controls(); clearTimeout(resizeTimer);
    if (!event.persisted) { timeline?.kill(); observer.disconnect(); }
  });
}
