'use strict';
const express=require('express'),http=require('http'),crypto=require('crypto'),path=require('path');
const {Server}=require('socket.io');
const app=express();app.use(express.static(path.join(__dirname,'public')));app.get('/health',(_,res)=>res.json({ok:true,game:'PATO MAFIA FBI'}));
const server=http.createServer(app),io=new Server(server,{pingTimeout:25000});const rooms=new Map();
const ROLE={rat:{name:'🐀 SZCZUR',side:'mafia',desc:'Sabotujesz ekipę nocą. Ukrywaj tożsamość i przetrwaj głosowania.'},agent:{name:'🕵️ AGENT FBI',side:'family',desc:'Co noc możesz sprawdzić, czy wybrana osoba jest Szczurem.'},guard:{name:'🛡️ OCHRONIARZ TACY',side:'family',desc:'Co noc wybierasz osobę, którą ochronisz przed porwaniem.'},joker:{name:'🎭 PROWOKATOR',side:'family',desc:'Mieszasz w zeznaniach, ale wygrywasz z Pato Rodziną.'},citizen:{name:'💎 ŚWIADEK PATO',side:'family',desc:'Obserwuj, blefuj i wskaż Szczura podczas głosowania.'}};
const QUESTIONS=['Kto ostatnio widział Złotą Tacę i dlaczego nie zawiadomił Maćka?','Kto miał alibi tak słabe, że nawet Dominika go nie zapamiętała?','Czy Lukasita naprawdę wróciła z USA, czy to kolejna przykrywka?','Kto ukrywał się pod kanapą, kiedy zniknął Diament Euforii?','Dlaczego Malwina twierdzi, że ten dom jest także jej?','Kto powiedział „mnie nic nie klepie” tuż przed katastrofą?','Czy Maciek jako Wódz ma prawo przesłuchiwać samego siebie?','Kto ostatnio ćwiczył KÓŁECZKO na miejscu zbrodni?','Który podejrzany ma najsłabszą historię o zepsutym e-papierosie?','Czy Michał Sobota jest dowodem, że weekend nigdy się nie kończy?','Kto wydał rozkaz przeniesienia Diamentu Euforii do lodówki?','Kto z obecnych może być podwójnym agentem Patronatu Szczura?'];
const EVIDENCE=['Na podłodze znaleziono złoty brokat i jeden klapek.','Świadek słyszał: „przecież ja tu mieszkam!”.','Monitoring pokazuje kogoś robiącego KÓŁECZKO tyłem.','Znaleziono notatkę: „Mnie nic nie klepie”.','Pod kanapą leżała pusta teczka z napisem „FBI – TAJNE”.','Z pokoju dobiegł okrzyk „Lukasita wróciła!”.','Odciski palców są na tacy. Nikt nie pamięta, czyja to taca.','W szafce leżał zepsuty e-papieros. Podobno znowu wadliwy.','Ktoś zmienił hasło do akt na „DIAMENT_EUFORII”.','Patron Czarek zostawił pieczęć w kształcie szczura.'];
function uid(){return crypto.randomUUID()}function code(){return crypto.randomBytes(3).toString('hex').toUpperCase()}function clean(x,n=80){return String(x??'').trim().slice(0,n)}function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function err(cb,e){cb?.({ok:false,error:e})}function success(cb,d={}){cb?.({ok:true,...d})}function pl(r,s){return r.players.find(p=>p.id===s.data.player)}function rm(s){return rooms.get(s.data.room)}function isHost(r,s){return r?.host===s.data.player}function alive(r){return r.players.filter(p=>p.alive)}
function view(r){return {code:r.code,host:r.host,phase:r.phase,chapter:r.chapter,maxChapters:r.maxChapters,question:r.question,evidence:r.evidence,notice:r.notice,players:r.players.map(p=>({id:p.id,name:p.name,online:p.online,alive:p.alive,score:p.score,submitted:!!r.answers[p.id]})),submitted:Object.keys(r.answers).length,eligible:(r.phase==='night'?alive(r).filter(p=>p.role!=='citizen'&&p.role!=='joker'):alive(r)).length,log:r.log.slice(-12),tally:r.phase==='verdict'?r.tally:null,winner:r.winner,eliminated:r.eliminated,ratNames:r.phase==='final'?r.players.filter(p=>p.role==='rat').map(p=>p.name):[]}}
function broadcast(r){io.to(r.code).emit('state',view(r));for(const p of r.players){let socket=io.sockets.sockets.get(p.socketId);if(socket)privateState(r,p,socket)}}
function privateState(r,p,s){s.emit('private',{id:p.id,role:p.role?ROLE[p.role]:null,roleKey:p.role,alive:p.alive,report:p.report,hasActed:Object.hasOwn(r.answers,p.id),isRat:p.role==='rat'})}
function requireRoom(s,cb){const r=rm(s);if(!r||!pl(r,s)){err(cb,'Brak pokoju – dołącz ponownie.');return null}return r}
function phases(r,phase){r.phase=phase;r.answers={};r.tally=null;r.eliminated=null;r.question=QUESTIONS[(r.chapter-1)%QUESTIONS.length];r.evidence=EVIDENCE[(r.chapter-1)%EVIDENCE.length];r.notice='';}
function win(r){const rats=alive(r).filter(p=>p.role==='rat').length,good=alive(r).length-rats;if(rats===0){r.phase='final';r.winner='family';r.notice='💎 PATO RODZINA ODNALEZŁA SZCZURA!';return true}if(rats>=good){r.phase='final';r.winner='mafia';r.notice='🐀 SZCZUR PRZEJĄŁ ZŁOTĄ TACĘ!';return true}if(r.chapter>=r.maxChapters&&r.phase==='verdict'){r.phase='final';r.winner='mafia';r.notice='⌛ Czas minął. Szczur zniknął z tacą!';return true}return false}
function start(r){let ps=shuffle(r.players);r.chapter=1;r.winner=null;r.log=[];r.players.forEach(p=>{p.alive=true;p.score=0;p.report='';p.role='citizen'});ps[0].role='rat';if(ps.length>=7)ps[1].role='rat';ps[ps[1].role==='rat'?2:1].role='agent';if(ps.length>=4)ps[ps[1].role==='rat'?3:2].role='guard';if(ps.length>=6)ps[ps.length-1].role='joker';r.log.push('🚨 AKTA FBI OTWARTE. Tożsamości utajnione.');phases(r,'night');r.notice='🌙 NOC 1: Szczur sabotuje, Agent bada, Ochroniarz chroni.';broadcast(r)}
function finishNight(r){const actions=Object.entries(r.answers);const ratTargets=actions.filter(([id])=>r.players.find(p=>p.id===id)?.role==='rat').map(([,v])=>v);const target=ratTargets.length?ratTargets.sort((a,b)=>ratTargets.filter(x=>x===b).length-ratTargets.filter(x=>x===a).length)[0]:null;const guards=actions.filter(([id])=>r.players.find(p=>p.id===id)?.role==='guard').map(([,v])=>v);const t=r.players.find(p=>p.id===target);if(t&&t.alive){if(guards.includes(target)){r.log.push('🛡️ Ktoś ochronił ofiarę! Tej nocy nikt nie znika.')}else{t.alive=false;r.log.push('💥 Zniknął świadek: '+t.name+'. Jego akta trafiają do archiwum.')}}else r.log.push('🌙 Noc zakończona bez porwania.');for(const [id,to] of actions){const p=r.players.find(x=>x.id===id);if(p?.role==='agent'){const found=r.players.find(x=>x.id===to);p.report=`🔎 Tajny raport FBI: ${found?.name||'Nieznany'} ${found?.role==='rat'?'JEST SZCZUREM! 🐀':'NIE JEST SZCZUREM.'}`;p.score+=25}}r.chapter=Math.max(1,r.chapter);phases(r,'debate');r.notice='☀️ ŚLEDZTWO: opowiedzcie swoje alibi. Prowadzący uruchamia głosowanie.';if(!win(r))broadcast(r);else broadcast(r)}
function finishVote(r){let tally={};for(const [id,t] of Object.entries(r.answers)){if(r.players.find(x=>x.id===id)?.alive&&alive(r).some(p=>p.id===t))tally[t]=(tally[t]||0)+1}r.tally=tally;const high=Math.max(0,...Object.values(tally));const leaders=Object.entries(tally).filter(([,v])=>v===high).map(([id])=>id);if(high&&leaders.length===1){const ban=r.players.find(p=>p.id===leaders[0]);ban.alive=false;r.eliminated={name:ban.name,role:ROLE[ban.role].name};r.log.push(`⚖️ EKIPA WYELIMINOWAŁA: ${ban.name} (${ROLE[ban.role].name})`);for(const p of alive(r))if(p.role!=='rat')p.score+=ban.role==='rat'?100:0}else r.log.push('⚖️ REMIS / BRAK GŁOSÓW: nikt nie odpada.');r.phase='verdict';r.answers={};r.notice='⚖️ Wyrok ogłoszony. Czy to koniec Szczura?';win(r);broadcast(r)}
function next(r){if(r.phase!=='verdict')return;r.chapter++;phases(r,'night');r.notice='🌙 NOC '+r.chapter+': włączono alarm. Nowe akcje tajne.';broadcast(r)}
io.on('connection',s=>{
 s.on('create',({name}={},cb)=>{name=clean(name,24);if(!name)return err(cb,'Wpisz imię.');let c;do{c=code()}while(rooms.has(c));const p={id:uid(),name,token:uid(),socketId:s.id,online:true,role:null,alive:true,score:0,report:''};const r={code:c,host:p.id,players:[p],phase:'lobby',chapter:0,maxChapters:6,answers:{},log:[],created:Date.now(),question:'',evidence:'',notice:'',winner:null,tally:null,eliminated:null};rooms.set(c,r);s.join(c);s.data={room:c,player:p.id};success(cb,{id:p.id,token:p.token,code:c});broadcast(r)});
 s.on('join',({name,code:c}={},cb)=>{c=clean(c,8).toUpperCase();name=clean(name,24);const r=rooms.get(c);if(!r)return err(cb,'Nie ma takiego pokoju.');if(r.phase!=='lobby')return err(cb,'Gra już trwa.');if(r.players.length>=10)return err(cb,'Maksymalnie 10 osób.');if(!name)return err(cb,'Wpisz imię.');let p={id:uid(),name,token:uid(),socketId:s.id,online:true,role:null,alive:true,score:0,report:''};r.players.push(p);s.join(c);s.data={room:c,player:p.id};success(cb,{id:p.id,token:p.token,code:c});broadcast(r)});
 s.on('rejoin',({token}={},cb)=>{for(const r of rooms.values()){const p=r.players.find(x=>x.token===token);if(!p)continue;p.socketId=s.id;p.online=true;s.join(r.code);s.data={room:r.code,player:p.id};success(cb,{id:p.id,code:r.code});broadcast(r);return}err(cb,'Sesja wygasła. Dołącz ponownie.')});
 s.on('start',(_,cb)=>{const r=requireRoom(s,cb);if(!r)return;if(!isHost(r,s))return err(cb,'Tylko prowadzący.');if(r.phase!=='lobby')return err(cb,'Gra już się rozpoczęła.');if(r.players.length<3)return err(cb,'Do gry potrzeba minimum 3 graczy.');start(r);success(cb)});
 s.on('act',({target}={},cb)=>{const r=requireRoom(s,cb);if(!r)return;const p=pl(r,s);if(r.phase!=='night'||!p.alive)return err(cb,'Nie możesz teraz działać.');if(!['rat','agent','guard'].includes(p.role))return err(cb,'Nie masz akcji nocnej.');if(Object.hasOwn(r.answers,p.id))return err(cb,'Już wykonano akcję.');const t=alive(r).find(x=>x.id===target);if(!t||t.id===p.id)return err(cb,'Wybierz inną żyjącą osobę.');if(p.role==='rat'&&t.role==='rat')return err(cb,'Nie możesz porwać drugiego Szczura.');r.answers[p.id]=target;success(cb);broadcast(r)});
 s.on('vote',({target}={},cb)=>{const r=requireRoom(s,cb);if(!r)return;const p=pl(r,s);if(r.phase!=='vote'||!p.alive)return err(cb,'Głosowanie nieaktywne.');if(Object.hasOwn(r.answers,p.id))return err(cb,'Już zagłosowano.');if(!alive(r).some(x=>x.id===target&&x.id!==p.id))return err(cb,'Wybierz innego żyjącego gracza.');r.answers[p.id]=target;success(cb);broadcast(r);if(Object.keys(r.answers).length>=alive(r).length)finishVote(r)});
 s.on('advance',(_,cb)=>{const r=requireRoom(s,cb);if(!r)return;if(!isHost(r,s))return err(cb,'Tylko prowadzący.');if(r.phase==='night'){finishNight(r)}else if(r.phase==='debate'){phases(r,'vote');r.notice='⚖️ GŁOSOWANIE: kto jest Szczurem?';broadcast(r)}else if(r.phase==='vote'){finishVote(r)}else if(r.phase==='verdict'){next(r)}else return err(cb,'Nie można teraz przejść dalej.');success(cb)});
 s.on('restart',(_,cb)=>{const r=requireRoom(s,cb);if(!r)return;if(!isHost(r,s))return err(cb,'Tylko prowadzący.');r.phase='lobby';r.chapter=0;r.answers={};r.log=[];r.winner=null;r.players.forEach(p=>{p.role=null;p.alive=true;p.score=0;p.report=''});broadcast(r);success(cb)});
 s.on('close',(_,cb)=>{const r=requireRoom(s,cb);if(!r)return;if(!isHost(r,s))return err(cb,'Tylko prowadzący.');rooms.delete(r.code);io.to(r.code).emit('closed');for(const p of r.players){const sock=io.sockets.sockets.get(p.socketId);if(sock){sock.leave(r.code);sock.data={}}}success(cb)});
 
  s.on('addBot', (_, cb) => {
  const r = requireRoom(s, cb);
  if (!r) return;
  if (!isHost(r, s)) return err(cb, 'Tylko Wódz dodaje boty.');
  if (r.phase !== 'lobby') return err(cb, 'Gra już trwa.');
  if (r.players.length >= 10) return err(cb, 'Pokój jest pełny.');

  const names = ['Szczur FBI', 'Agent Klapek', 'Taca 007', 'Diamentowy Janusz', 'Lukasita BOT'];
  const count = r.players.filter(p => p.bot).length;
  r.players.push({
    id: uid(),
    name: names[count % names.length],
    token: uid(),
    socketId: null,
    online: true,
    bot: true,
    role: null,
    alive: true,
    score: 0,
    report: ''
  });

  success(cb);
  broadcast(r);
});

s.on('removeBots', (_, cb) => {
  const r = requireRoom(s, cb);
  if (!r) return;
  if (!isHost(r, s)) return err(cb, 'Tylko Wódz usuwa boty.');
  if (r.phase !== 'lobby') return err(cb, 'Gra już trwa.');

  r.players = r.players.filter(p => !p.bot);
  success(cb);
  broadcast(r);
});

 s.on('disconnect',()=>{const r=rm(s);if(!r)return;const p=pl(r,s);if(p&&p.socketId===s.id){p.online=false;broadcast(r)}});
});
setInterval(()=>{for(const [c,r] of rooms)if(Date.now()-r.created>24*3600000)rooms.delete(c)},3600000).unref();server.listen(process.env.PORT||3000,()=>console.log('PATO MAFIA FBI online'));
