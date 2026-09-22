(() => {
'use strict';
const $=s=>document.querySelector(s), canvas=$('#game'), ctx=canvas.getContext('2d',{alpha:false});
const menu=$('#menu'), hud=$('#hud'), controls=$('#mobile-controls'), death=$('#death'), statusEl=$('#status');
const MAP=[
'1111111111111111','1000000000000001','1011100110111101','1000100000100001',
'1010101110101101','1010001000000101','1011101011110101','1000001000000001',
'1011011110110101','1001000000010001','1101011011010111','1000010001000001',
'1011110111011101','1000000000000001','1000110011100001','1111111111111111'];
const W=16,H=16,FOV=Math.PI/3, MAX_DIST=20;
let mode='deathmatch', running=false, socket=null, room='LOCAL', online=false, last=0, fireCooldown=0, timeLeft=300, flash=0;
let keys={}, input={move:0,strafe:0,turn:0,firing:false};
let player={id:'local',name:'Ranger',x:2.5,y:2.5,a:0,hp:100,score:0,dead:false};
let entities=new Map(), monsters=new Map();
const spawnPoints=[[2.5,2.5],[13.5,2.5],[2.5,13.5],[13.5,13.5],[7.5,7.5]];

const PREFS_KEY='sectorPrefs';
function loadPrefs(){
  try{
    const raw=localStorage.getItem(PREFS_KEY);
    return raw?JSON.parse(raw):{};
  }catch(_){
    return {};
  }
}
function savePrefs(patch){
  const prefs={...loadPrefs(),...patch};
  try{localStorage.setItem(PREFS_KEY,JSON.stringify(prefs))}catch(_){/* ignore */}
  return prefs;
}
function applyPrefsToMenu(){
  const prefs=loadPrefs();
  if(typeof prefs.name==='string')$('#name').value=prefs.name.slice(0,12)||'Ranger';
  if(typeof prefs.room==='string')$('#room').value=prefs.room.slice(0,6);
  if(typeof prefs.server==='string')$('#server').value=prefs.server;
  if(prefs.mode==='coop'||prefs.mode==='deathmatch'){
    mode=prefs.mode;
    document.querySelectorAll('.mode').forEach(b=>{
      b.classList.toggle('active',b.dataset.mode===mode);
    });
  }
}

function resize(){const d=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.floor(innerWidth*d);canvas.height=Math.floor(innerHeight*d);ctx.setTransform(d,0,0,d,0,0);}
addEventListener('resize',resize);resize();
function wall(x,y){return x<0||y<0||x>=W||y>=H||MAP[Math.floor(y)][Math.floor(x)]==='1'}
function safeMove(nx,ny){const r=.2;if(!wall(nx+r,player.y)&&!wall(nx-r,player.y))player.x=nx;if(!wall(player.x,ny+r)&&!wall(player.x,ny-r))player.y=ny;}
function angleDiff(a,b){return Math.atan2(Math.sin(a-b),Math.cos(a-b));}
function castRay(a){const step=.025, ca=Math.cos(a),sa=Math.sin(a);let d=0,x=player.x,y=player.y;while(d<MAX_DIST){d+=step;x=player.x+ca*d;y=player.y+sa*d;if(wall(x,y))return {d,x,y};}return {d:MAX_DIST,x,y};}
function colorWall(hit,a){const edge=Math.min(hit.x%1,hit.y%1,1-hit.x%1,1-hit.y%1);const shade=Math.max(35,155-hit.d*7)+(edge<.04?24:0);const warm=Math.abs(Math.sin(a*3))>.65;return warm?`rgb(${shade|0},${(shade*.63)|0},${(shade*.34)|0})`:`rgb(${(shade*.62)|0},${(shade*.72)|0},${shade|0})`;}
function render(){const w=innerWidth,h=innerHeight;ctx.fillStyle='#151a1d';ctx.fillRect(0,0,w,h/2);ctx.fillStyle='#26241f';ctx.fillRect(0,h/2,w,h/2);const rays=Math.min(320,Math.ceil(w/3)),strip=w/rays;const depth=[];for(let i=0;i<rays;i++){const ra=player.a-FOV/2+FOV*(i/rays),hit=castRay(ra),d=hit.d*Math.cos(ra-player.a);depth[i]=d;const wh=Math.min(h*1.5,h/d*1.05);ctx.fillStyle=colorWall(hit,ra);ctx.fillRect(i*strip,h/2-wh/2,strip+1,wh);if(d>5){ctx.fillStyle=`rgba(0,0,0,${Math.min(.7,(d-5)/18)})`;ctx.fillRect(i*strip,h/2-wh/2,strip+1,wh)}}renderEntities(depth,rays,strip,w,h);if(flash>0){ctx.fillStyle=`rgba(255,235,170,${flash})`;ctx.fillRect(w*.43,h*.47,w*.14,h*.08);flash=Math.max(0,flash-.08)}drawWeapon(w,h);}
function renderEntities(depth,rays,strip,w,h){const all=[...entities.values(),...monsters.values()].filter(e=>e.id!==player.id&&!e.dead).map(e=>({...e,dist:Math.hypot(e.x-player.x,e.y-player.y)})).sort((a,b)=>b.dist-a.dist);for(const e of all){const ang=angleDiff(Math.atan2(e.y-player.y,e.x-player.x),player.a);if(Math.abs(ang)>FOV*.7||e.dist<.2)continue;const sx=w/2+(ang/FOV)*w, size=Math.min(h*1.2,h/e.dist*.72),ray=Math.floor(sx/strip);if(ray<0||ray>=rays||e.dist>depth[ray]+.4)continue;const isMonster=e.kind==='monster';ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(sx,h/2+size*.43,size*.28,size*.08,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=isMonster?'#ff604d':'#b9f227';ctx.fillRect(sx-size*.23,h/2-size*.43,size*.46,size*.72);ctx.fillStyle=isMonster?'#541d18':'#263409';ctx.fillRect(sx-size*.18,h/2-size*.34,size*.12,size*.11);ctx.fillRect(sx+size*.06,h/2-size*.34,size*.12,size*.11);ctx.fillStyle='#dad7c9';ctx.fillRect(sx-size*.28,h/2+size*.02,size*.56,size*.12);if(e.name){ctx.font='700 10px system-ui';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText(e.name,sx,h/2-size*.52)}}}
function drawWeapon(w,h){ctx.save();ctx.translate(w/2,h);ctx.fillStyle='#111516';ctx.beginPath();ctx.moveTo(-w*.1,0);ctx.lineTo(-w*.06,-h*.17);ctx.lineTo(w*.06,-h*.17);ctx.lineTo(w*.1,0);ctx.fill();ctx.fillStyle='#697174';ctx.fillRect(-w*.036,-h*.21,w*.072,h*.15);ctx.fillStyle='#b9f227';ctx.fillRect(-w*.018,-h*.19,w*.036,h*.035);ctx.restore();}
function update(dt){if(!running||player.dead)return;const speed=2.6,turn=2.2;let f=(keys.KeyW?1:0)-(keys.KeyS?1:0)+input.move,s=(keys.KeyD?1:0)-(keys.KeyA?1:0)+input.strafe,t=(keys.ArrowRight?1:0)-(keys.ArrowLeft?1:0)+input.turn;player.a+=t*turn*dt;const nx=player.x+(Math.cos(player.a)*f+Math.cos(player.a+Math.PI/2)*s)*speed*dt,ny=player.y+(Math.sin(player.a)*f+Math.sin(player.a+Math.PI/2)*s)*speed*dt;safeMove(nx,ny);fireCooldown-=dt;if((keys.Space||input.firing)&&fireCooldown<=0)shoot();if(!online){timeLeft=Math.max(0,timeLeft-dt);updateLocalMonsters(dt)}else send({type:'input',x:player.x,y:player.y,a:player.a,firing:false});$('#timer').textContent=formatTime(timeLeft);}
function shoot(){fireCooldown=.32;flash=.8;if(navigator.vibrate)navigator.vibrate(20);if(online){send({type:'shoot',a:player.a});return}let target=null,best=99;for(const m of monsters.values()){const d=Math.hypot(m.x-player.x,m.y-player.y),a=Math.abs(angleDiff(Math.atan2(m.y-player.y,m.x-player.x),player.a));if(!m.dead&&a<.09&&d<best&&castRay(player.a).d>d){target=m;best=d}}if(target){target.hp-=34;if(target.hp<=0){target.dead=true;player.score++;$('#score').textContent=player.score;feed(`Цель уничтожена · +1`);setTimeout(()=>spawnMonster(target),2500)}}}
function spawnMonster(m){const p=spawnPoints[(Math.random()*spawnPoints.length)|0];Object.assign(m,{x:p[0],y:p[1],hp:100,dead:false})}
function updateLocalMonsters(dt){for(const m of monsters.values()){if(m.dead)continue;const d=Math.hypot(player.x-m.x,player.y-m.y);if(d<8&&d>.65){const a=Math.atan2(player.y-m.y,player.x-m.x),nx=m.x+Math.cos(a)*dt*.55,ny=m.y+Math.sin(a)*dt*.55;if(!wall(nx,ny)){m.x=nx;m.y=ny}}if(d<.72){m.cool=(m.cool||0)-dt;if(m.cool<=0){m.cool=1;damage(12)}}}}
function damage(n){player.hp=Math.max(0,player.hp-n);$('#health').textContent=player.hp;if(player.hp<=0)die();}
function die(){player.dead=true;running=false;$('#death-score').textContent=`Счёт: ${player.score}`;death.classList.remove('hidden');controls.classList.add('hidden');}
function respawn(){const p=spawnPoints[(Math.random()*4)|0];Object.assign(player,{x:p[0],y:p[1],a:Math.random()*6.28,hp:100,dead:false});$('#health').textContent='100';death.classList.add('hidden');running=true;if(matchMedia('(pointer:coarse)').matches)controls.classList.remove('hidden');if(online)send({type:'respawn'});}
function loop(ts){const dt=Math.min(.05,(ts-last)/1000||0);last=ts;update(dt);render();requestAnimationFrame(loop)}requestAnimationFrame(loop);
function formatTime(s){s=Math.max(0,s|0);return `${String((s/60)|0).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function feed(text){const p=document.createElement('p');p.textContent=text;$('#feed').prepend(p);setTimeout(()=>p.remove(),3000)}
function send(data){if(socket?.readyState===1)socket.send(JSON.stringify(data))}
function connect(){let url=$('#server').value.trim();if(!url){statusEl.textContent='Укажите адрес сервера Render или запустите тренировку.';return}url=url.replace(/^http/,'ws').replace(/\/$/,'');savePrefs({server:url,name:$('#name').value.trim()||'Ranger',room:$('#room').value.trim().toUpperCase(),mode});statusEl.textContent='Устанавливаем защищённый канал…';socket=new WebSocket(url);socket.onopen=()=>send({type:'join',room:$('#room').value.trim().toUpperCase(),mode,name:$('#name').value.trim()||'Ranger'});socket.onmessage=e=>handleMessage(JSON.parse(e.data));socket.onerror=()=>statusEl.textContent='Сервер недоступен. Проверьте адрес или попробуйте позже.';socket.onclose=()=>{if(online){feed('Связь с сервером потеряна');online=false}}}
function handleMessage(m){if(m.type==='welcome'){online=true;room=m.room;player.id=m.id;Object.assign(player,m.player);timeLeft=m.timeLeft;startGame(m.mode);feed(`Комната ${room} готова`)}else if(m.type==='state'){timeLeft=m.timeLeft;const mine=m.players.find(p=>p.id===player.id);if(mine){player.hp=mine.hp;player.score=mine.score;player.dead=mine.dead;$('#health').textContent=player.hp;$('#score').textContent=player.score;if(player.dead&&running)die()}entities=new Map(m.players.map(p=>[p.id,p]));monsters=new Map((m.monsters||[]).map(x=>[x.id,x]));}else if(m.type==='event')feed(m.text);else if(m.type==='error')statusEl.textContent=m.message;}
function startGame(selected){mode=selected;menu.classList.add('hidden');death.classList.add('hidden');hud.classList.remove('hidden');if(matchMedia('(pointer:coarse)').matches)controls.classList.remove('hidden');$('#room-code').textContent=room;$('#mode-label').textContent=online?(mode==='coop'?'КООПЕРАТИВ':'DEATHMATCH'):'ТРЕНИРОВКА';running=true;player.dead=false;}
function startOffline(){online=false;room='LOCAL';const nm=$('#name').value.trim()||'Ranger';player.name=nm;player.score=0;timeLeft=300;savePrefs({name:nm,room:$('#room').value.trim().toUpperCase(),mode});monsters.clear();for(let i=0;i<(mode==='coop'?5:3);i++){const p=spawnPoints[(i+1)%spawnPoints.length];monsters.set('m'+i,{id:'m'+i,kind:'monster',name:'DRONE',x:p[0],y:p[1],hp:100,dead:false})}startGame(mode)}
function stick(el,cb){let id=null,cx=0,cy=0,knob=el.querySelector('i');const end=()=>{id=null;knob.style.transform='';cb(0,0)};el.addEventListener('pointerdown',e=>{id=e.pointerId;const r=el.getBoundingClientRect();cx=r.left+r.width/2;cy=r.top+r.height/2;el.setPointerCapture(id)});el.addEventListener('pointermove',e=>{if(e.pointerId!==id)return;let x=(e.clientX-cx)/45,y=(e.clientY-cy)/45,l=Math.hypot(x,y);if(l>1){x/=l;y/=l}knob.style.transform=`translate(${x*34}px,${y*34}px)`;cb(x,y)});el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end)}
stick($('#move-pad'),(x,y)=>{input.strafe=x;input.move=-y});stick($('#look-pad'),(x,y)=>{input.turn=x});
$('#fire').addEventListener('pointerdown',e=>{e.preventDefault();input.firing=true});$('#fire').addEventListener('pointerup',()=>input.firing=false);$('#fire').addEventListener('pointercancel',()=>input.firing=false);
document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Space')e.preventDefault()});document.addEventListener('keyup',e=>keys[e.code]=false);
canvas.addEventListener('click',()=>{if(running&&matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.()});document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas)player.a+=e.movementX*.0025});
document.querySelectorAll('.mode').forEach(b=>b.onclick=()=>{document.querySelectorAll('.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');mode=b.dataset.mode;savePrefs({mode})});
$('#online').onclick=connect;$('#offline').onclick=startOffline;$('#respawn').onclick=respawn;$('#exit').onclick=()=>location.reload();
applyPrefsToMenu();
})();