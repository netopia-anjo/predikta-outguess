const CACHE='outguess-tv-v2';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('outguess-tv-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/fonts/')||url.pathname.startsWith('/brand/')||url.pathname.startsWith('/content/ads/')){
    event.respondWith(caches.open(CACHE).then(async cache=>{
      const existing=await cache.match(request);
      if(existing)return existing;
      const response=await fetch(request);
      if(response.ok)await cache.put(request,response.clone());
      return response;
    }));
  }else if(request.mode==='navigate'&&url.pathname==='/tv'){
    event.respondWith(fetch(request).then(async response=>{
      if(response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}
      return response;
    }).catch(async()=>await caches.match(request)||new Response('Reconnect to load the booth game.',{status:503})));
  }
});
