const CACHE='mealplan-shell-v1.7.1';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./pantry-v16.css','./pantry-v16.js','./smart-pantry-v17.js','./smart-pantry-v17.css'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mealplan-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;e.respondWith(fetch(e.request).then(res=>{if(!res.ok)return res;let clone=res.clone();caches.open(CACHE).then(c=>c.put(e.request,clone)).catch(()=>{});return res}).catch(()=>caches.match(e.request)))});
