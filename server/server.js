'use strict';
const http=require('http'),crypto=require('crypto');
const PORT=process.env.PORT||3000, rooms=new Map();
const spawns=[[2.5,2.5],[13.5,2.5],[2.5,13.5],[13.5,13.5],[7.5,7.5]];
const server=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');if(req.url==='/health')return res.end(JSON.stringify({ok:true,rooms:rooms.size}));res.statusCode=200;res.end(JSON.stringify({name:'Sector 13 server',status:'online',rooms:rooms.size}));});
function code(){let s='';const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let i=0;i<5;i++)s+=chars[(Math.random()*chars.length)|0];return s}
function uid(){return crypto.randomBytes(4).toString('hex')}
function frame(text){const p=Buffer.from(text),len=p.length;let h;if(len<126){h=Buffer.alloc(2);h[1]=len}else if(len<65536){h=Buffer.alloc(4);h[1]=126;h.writeUInt16BE(len,2)}else{h=Buffer.alloc(10);h[1]=127;h.writeBigUInt64BE(BigInt(len),2)}h[0]=0x81;return Buffer.concat([h,p])}
function decode(buf){const out=[];let o=0;while(o+2<=buf.length){const opcode=buf[o]&15,masked=!!(buf[o+1]&128);let len=buf[o+1]&127,head=2;if(len===126){if(o+4>buf.length)break;len=buf.readUInt16BE(o+2);head=4}else if(len===127){if(o+10>buf.length)break;len=Number(buf.readBigUInt64BE(o+2));head=10}const maskAt=o+head,dataAt=maskAt+(masked?4:0);if(dataAt+len>buf.length)break;let p=Buffer.from(buf.subarray(dataAt,dataAt+len));if(masked){const m=buf.subarray(maskAt,maskAt+4);for(let i=0;i<p.length;i++)p[i]^=m[i%4]}out.push({opcode,text:p.toString()});o=dataAt+len}return out}
function send(c,obj){if(!c.socket.destroyed)c.socket.write(frame(JSON.stringify(obj)))}
function broadcast(r,obj){for(const c of r.clients.values())send(c,obj)}
function statePayload(r){return {type:'state',timeLeft:r.timeLeft,players:[...r.players.values()],monsters:[...r.monsters.values()]}}
function broadcastState(r){broadcast(r,statePayload(r))}
function makeRoom(requested,mode){let id=(requested||'').replace(/[^A-Z0-9]/g,'').slice(0,6);if(!id)do{id=code()}while(rooms.has(id));if(rooms.has(id))return rooms.get(id);const r={id,mode:mode==='coop'?'coop':'deathmatch',clients:new Map(),players:new Map(),monsters:new Map(),timeLeft:300,last:Date.now()};if(r.mode==='coop')for(let i=0;i<6;i++){const p=spawns[(i+1)%spawns.length];r.monsters.set('m'+i,{id:'m'+i,kind:'monster',name:'BREACHER',x:p[0]+Math.random()*.3,y:p[1]+Math.random()*.3,hp:100,dead:false,cool:0})}rooms.set(id,r);return r}
function spawn(p){const s=spawns[(Math.random()*4)|0];p.x=s[0];p.y=s[1];p.a=Math.random()*Math.PI*2;p.hp=100;p.dead=false;delete p.shotAt}
function join(c,m){const r=makeRoom(String(m.room||'').toUpperCase(),m.mode);if(r.clients.size>=4)return send(c,{type:'error',message:'Комната заполнена'});c.room=r;c.id=uid();const p={id:c.id,name:String(m.name||'Ranger').slice(0,12),x:2.5,y:2.5,a:0,hp:100,score:0,dead:false};spawn(p);r.clients.set(c.id,c);r.players.set(c.id,p);send(c,{type:'welcome',id:c.id,room:r.id,mode:r.mode,player:p,timeLeft:r.timeLeft});broadcast(r,{type:'event',text:`${p.name} подключился`})}
function hitScan(r,shooter,a){let target=null,best=12;if(r.mode==='deathmatch'){
		for(const p of r.players.values()){
			if(p.id===shooter.id||p.dead)continue;
			const d=Math.hypot(p.x-shooter.x,p.y-shooter.y),da=Math.abs(Math.atan2(Math.sin(Math.atan2(p.y-shooter.y,p.x-shooter.x)-a),Math.cos(Math.atan2(p.y-shooter.y,p.x-shooter.x)-a)));
			if(d<best&&da<.11){target=p;best=d}
		}
	}else{
		for(const m of r.monsters.values()){
			if(m.dead)continue;
			const d=Math.hypot(m.x-shooter.x,m.y-shooter.y),da=Math.abs(Math.atan2(Math.sin(Math.atan2(m.y-shooter.y,m.x-shooter.x)-a),Math.cos(Math.atan2(m.y-shooter.y,m.x-shooter.x)-a)));
			if(d<best&&da<.12){target=m;best=d}
		}
	}
	if(!target)return;
	target.hp-=34;
	if(target.hp<=0){
		target.hp=0;
		target.dead=true;
		shooter.score++;
		broadcast(r,{type:'event',text:`${shooter.name} уничтожил цель`});
		if(target.kind==='monster')setTimeout(()=>{const s=spawns[(Math.random()*spawns.length)|0];Object.assign(target,{x:s[0],y:s[1],hp:100,dead:false})},3000);
	}
}
function message(c,m){
	if(m.type==='join')return join(c,m);
	const r=c.room,p=r&&r.players.get(c.id);
	if(!p)return;
	if(m.type==='input'&&!p.dead){
		const x=Number(m.x),y=Number(m.y),a=Number(m.a);
		if(Number.isFinite(x)&&Number.isFinite(y)&&Math.hypot(x-p.x,y-p.y)<1){
			p.x=Math.max(1.15,Math.min(14.85,x));
			p.y=Math.max(1.15,Math.min(14.85,y));
			p.a=a;
		}
	}else if(m.type==='shoot'&&!p.dead){
		const now=Date.now();
		if(!p.shotAt||now-p.shotAt>240){
			p.shotAt=now;
			hitScan(r,p,Number(m.a)||p.a);
		}
	}else if(m.type==='respawn'){
		const wasDead=!!p.dead;
		spawn(p);
		if(wasDead)broadcast(r,{type:'event',text:`${p.name} возродился`});
		// Important: push a fresh state snapshot immediately to avoid any
		// lingering client-side dead/invisible state.
		broadcastState(r);
	}
}
function remove(c){const r=c.room;if(!r)return;const p=r.players.get(c.id);r.clients.delete(c.id);r.players.delete(c.id);if(p)broadcast(r,{type:'event',text:`${p.name} покинул сектор`});if(!r.clients.size)rooms.delete(r.id)}
server.on('upgrade',(req,socket)=>{if((req.headers.upgrade||'').toLowerCase()!=='websocket')return socket.destroy();const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');const c={socket,id:null,room:null};socket.on('data',buf=>{try{for(const f of decode(buf)){if(f.opcode===8){socket.end();break}if(f.opcode===1)message(c,JSON.parse(f.text))}}catch(e){send(c,{type:'error',message:'Некорректное сообщение'})}});socket.on('close',()=>remove(c));socket.on('error',()=>remove(c))});
function tick(){
	const now=Date.now();
	for(const r of rooms.values()){
		const dt=Math.min(.1,(now-r.last)/1000);
		r.last=now;
		r.timeLeft=Math.max(0,r.timeLeft-dt);
		if(r.mode==='coop')for(const m of r.monsters.values()){
			if(m.dead)continue;
			let target=null,best=99;
			for(const p of r.players.values()){
				if(p.dead)continue;
				const d=Math.hypot(p.x-m.x,p.y-m.y);
				if(d<best){best=d;target=p}
			}
			if(target&&best<9){
				if(best>.62){
					const a=Math.atan2(target.y-m.y,target.x-m.x);
					m.x+=Math.cos(a)*dt*.52;
					m.y+=Math.sin(a)*dt*.52;
				}else if((m.cool-=dt)<=0){
					m.cool=1;
					target.hp-=12;
					if(target.hp<=0){
						target.hp=0;
						target.dead=true;
						broadcast(r,{type:'event',text:`${target.name} выбыл`});
					}
				}
			}
		}
		broadcastState(r);
	}
}
setInterval(tick,80);
server.listen(PORT,()=>console.log(`Sector 13 server listening on ${PORT}`));
