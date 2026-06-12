module.exports=[36028,e=>{"use strict";var t=e.i(58318);function r(e,t,r,i){if(!e)return"";let a=new Date(e);return isNaN(a.getTime())?"":a.toLocaleString("en-US",{...t,...r,timeZone:i})}function i(e,t){return r(e,{hour:"numeric",minute:"2-digit"},t,"UTC")}function a(e,t){return r(e,{month:"short",day:"numeric",year:"numeric"},t,"UTC")}function n(e,i){return r(e,{hour:"numeric",minute:"2-digit"},i,t.TIMEZONE)}function s(e,i){return r(e,{month:"short",day:"numeric",year:"numeric"},i,t.TIMEZONE)}function o(e,i){return r(e,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"},i,t.TIMEZONE)}function l(e){var r;let i,a,n;if(!e)return null;let s=e.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);if(!s)return null;let o=Date.UTC(Number(s[1]),Number(s[2])-1,Number(s[3]),Number(s[4]),Number(s[5])),l=(r=new Date(o),i=new Intl.DateTimeFormat("en-US",{timeZone:t.TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1}).formatToParts(r),24===(n=(a=e=>Number(i.find(t=>t.type===e)?.value))("hour"))&&(n=0),Date.UTC(a("year"),a("month")-1,a("day"),n,a("minute"),a("second"))-r.getTime());return new Date(o-l).toISOString()}e.s(["fmtSessionDate",()=>a,"fmtSessionTime",()=>i,"fmtStampDate",()=>s,"fmtStampDateTime",()=>o,"fmtStampTime",()=>n,"studioInputToUtcISO",()=>l])},9487,e=>{"use strict";var t=e.i(58318);let r={mp3_lease:{streamingLimit:"Up to 500,000 streams across all platforms",salesLimit:"Up to 5,000 paid downloads or physical copies",musicVideos:"Unlimited music videos (may be monetized)",performances:"Unlimited live performances",radioStations:"Up to 2 radio stations",exclusive:!1,transferable:!1},trackout_lease:{streamingLimit:"Up to 1,000,000 streams across all platforms",salesLimit:"Up to 10,000 paid downloads or physical copies",musicVideos:"Unlimited music videos (may be monetized)",performances:"Unlimited live performances",radioStations:"Unlimited radio stations",exclusive:!1,transferable:!1},exclusive:{streamingLimit:"Unlimited streams",salesLimit:"Unlimited sales and distribution",musicVideos:"Unlimited music videos",performances:"Unlimited performances",radioStations:"Unlimited",exclusive:!0,transferable:!0}};function i(e){let{buyerName:i,buyerEmail:a,beatTitle:n,producerName:s,licenseType:o,amountPaid:l,purchaseDate:u,purchaseId:d}=e,c=t.BEAT_LICENSES[o],m=r[o],p=`$${(l/100).toFixed(2)}`;return`
════════════════════════════════════════════════════════
           SWEET DREAMS MUSIC — BEAT LICENSE AGREEMENT
════════════════════════════════════════════════════════

License Type: ${c.name}
Purchase ID: ${d}
Date of Agreement: ${u}

────────────────────────────────────────────────────────
PARTIES
────────────────────────────────────────────────────────
Licensor: Sweet Dreams Music LLC, Fort Wayne, IN
          (on behalf of producer "${s}")
Licensee: ${i}
          Email: ${a}

────────────────────────────────────────────────────────
BEAT INFORMATION
────────────────────────────────────────────────────────
Title: "${n}"
Producer: ${s}
Amount Paid: ${p}
Delivery Format: ${c.deliveryFormat}

────────────────────────────────────────────────────────
LICENSE GRANT
────────────────────────────────────────────────────────
${m.exclusive?"This is an EXCLUSIVE license. The beat will be removed from the store and no further licenses will be issued. All rights to the beat transfer to the Licensee, except the producer retains credit rights.":"This is a NON-EXCLUSIVE license. The producer retains the right to license this beat to other parties."}

Permitted Use:
  • Streaming: ${m.streamingLimit}
  • Sales/Distribution: ${m.salesLimit}
  • Music Videos: ${m.musicVideos}
  • Live Performances: ${m.performances}
  • Radio: ${m.radioStations}
  • Transferable: ${m.transferable?"Yes":"No — this license is non-transferable"}

────────────────────────────────────────────────────────
RESTRICTIONS
────────────────────────────────────────────────────────
1. The Licensee may NOT claim ownership of the underlying
   composition or production.
2. The Licensee may NOT resell, sublicense, or redistribute
   the beat itself (only derivative works using the beat).
3. The Licensee MUST credit the producer as
   "Prod. by ${s}" in all published works.
4. ${m.exclusive?"The producer retains the right to be credited on all works created using this beat.":"If license limits are exceeded, the Licensee must purchase an upgraded license before continued use."}

${!m.exclusive?`────────────────────────────────────────────────────────
LICENSE DURATION
────────────────────────────────────────────────────────
${t.LEASE_DURATION_DAYS[o]?`This license is valid for ${365===t.LEASE_DURATION_DAYS[o]?"1 year":"2 years"} from the date of purchase, or until the stream/distribution caps above are reached, whichever comes first.

Upon expiration, you may renew this license at 75% of the
original purchase price. Renewal extends the license for
another full term with reset stream/distribution caps.

If an exclusive license is purchased by another party
during your lease term, your license remains valid until
its expiration date but cannot be renewed.`:`This is a LIFETIME LEASE. This license does not expire
and stream/distribution caps do not apply. However, if
an exclusive license is purchased by another party, your
license remains valid permanently but the beat will be
removed from the store.`}

`:""}────────────────────────────────────────────────────────
DELIVERY & ACCESS
────────────────────────────────────────────────────────
Files are available for download immediately after purchase
through the Sweet Dreams Music platform. Downloads are
limited to 10 per purchase. Files can also be accessed
from the "My Purchases" section of your dashboard at
sweetdreamsmusic.com/dashboard/purchases.

${!m.exclusive?`────────────────────────────────────────────────────────
UPGRADES
────────────────────────────────────────────────────────
To upgrade your license (e.g., MP3 Lease to Trackout or
Exclusive Rights), visit your purchases dashboard or
contact us:

  Jay Val Leo — jayvalleo@sweetdreamsmusic.com
  Cole — cole@sweetdreams.us

Upgrade pricing is the difference between your current
license and the target license.

`:""}────────────────────────────────────────────────────────
AGREEMENT
────────────────────────────────────────────────────────
This license agreement is legally binding upon completion
of purchase. By completing the transaction, the Licensee
acknowledges that they have read, understood, and agree
to all terms stated in this agreement.

This agreement is governed by the laws of the State of
Indiana, United States.

════════════════════════════════════════════════════════
Sweet Dreams Music LLC — Fort Wayne, IN
sweetdreamsmusic.com
════════════════════════════════════════════════════════
`.trim()}e.s(["generateLicenseText",()=>i])},11093,e=>{"use strict";var t=e.i(47909),r=e.i(74017),i=e.i(96250),a=e.i(59756),n=e.i(61916),s=e.i(74677),o=e.i(69741),l=e.i(16795),u=e.i(87718),d=e.i(95169),c=e.i(47587),m=e.i(66012),p=e.i(70101),h=e.i(26937),f=e.i(10372),E=e.i(93695);e.i(52474);var g=e.i(5232),y=e.i(89171),b=e.i(46e3),v=e.i(9487),T=e.i(36028);async function R(e){let t=await (0,b.createClient)(),{data:{user:r}}=await t.auth.getUser();if(!r)return y.NextResponse.json({error:"Login required"},{status:401});let{searchParams:i}=new URL(e.url),a=i.get("purchaseId");if(!a)return y.NextResponse.json({error:"purchaseId required"},{status:400});let n=(0,b.createServiceClient)(),{data:s,error:o}=await n.from("beat_purchases").select("*, beats(title, producer)").eq("id",a).single();if(o||!s)return y.NextResponse.json({error:"Purchase not found"},{status:404});if(s.buyer_id!==r.id&&s.buyer_email!==r.email)return y.NextResponse.json({error:"Unauthorized"},{status:403});let{data:l}=await n.from("profiles").select("display_name").eq("user_id",r.id).single(),u=l?.display_name||r.email?.split("@")[0]||"Buyer",d=Array.isArray(s.beats)?s.beats[0]:s.beats,c=(0,v.generateLicenseText)({buyerName:u,buyerEmail:s.buyer_email,beatTitle:d?.title||"Unknown",producerName:d?.producer||"Unknown",licenseType:s.license_type,amountPaid:s.amount_paid,purchaseDate:(0,T.fmtStampDate)(s.created_at),purchaseId:s.id});return y.NextResponse.json({license:c})}e.s(["GET",()=>R],65883);var w=e.i(65883);let S=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/beats/license/route",pathname:"/api/beats/license",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/apps/sweetdreams/app/api/beats/license/route.ts",nextConfigOutput:"",userland:w}),{workAsyncStorage:N,workUnitAsyncStorage:x,serverHooks:U}=S;function C(){return(0,i.patchFetch)({workAsyncStorage:N,workUnitAsyncStorage:x})}async function A(e,t,i){S.isDev&&(0,a.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let y="/api/beats/license/route";y=y.replace(/\/index$/,"")||"/";let b=await S.prepare(e,t,{srcPage:y,multiZoneDraftMode:!1});if(!b)return t.statusCode=400,t.end("Bad Request"),null==i.waitUntil||i.waitUntil.call(i,Promise.resolve()),null;let{buildId:v,params:T,nextConfig:R,parsedUrl:w,isDraftMode:N,prerenderManifest:x,routerServerContext:U,isOnDemandRevalidate:C,revalidateOnlyGenerated:A,resolvedPathname:I,clientReferenceManifest:L,serverActionsManifest:D}=b,_=(0,o.normalizeAppPath)(y),O=!!(x.dynamicRoutes[_]||x.routes[I]),P=async()=>((null==U?void 0:U.render404)?await U.render404(e,t,w,!1):t.end("This page could not be found"),null);if(O&&!N){let e=!!x.routes[I],t=x.dynamicRoutes[_];if(t&&!1===t.fallback&&!e){if(R.experimental.adapterPath)return await P();throw new E.NoFallbackError}}let $=null;!O||S.isDev||N||($="/index"===($=I)?"/":$);let M=!0===S.isDev||!O,k=O&&!M;D&&L&&(0,s.setManifestsSingleton)({page:y,clientReferenceManifest:L,serverActionsManifest:D});let q=e.method||"GET",F=(0,n.getTracer)(),H=F.getActiveScopeSpan(),j={params:T,prerenderManifest:x,renderOpts:{experimental:{authInterrupts:!!R.experimental.authInterrupts},cacheComponents:!!R.cacheComponents,supportsDynamicResponse:M,incrementalCache:(0,a.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:R.cacheLife,waitUntil:i.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,i,a)=>S.onRequestError(e,t,i,a,U)},sharedContext:{buildId:v}},V=new l.NodeNextRequest(e),B=new l.NodeNextResponse(t),G=u.NextRequestAdapter.fromNodeNextRequest(V,(0,u.signalFromNodeResponse)(t));try{let s=async e=>S.handle(G,j).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=F.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let i=r.get("next.route");if(i){let t=`${q} ${i}`;e.setAttributes({"next.route":i,"http.route":i,"next.span_name":t}),e.updateName(t)}else e.updateName(`${q} ${y}`)}),o=!!(0,a.getRequestMeta)(e,"minimalMode"),l=async a=>{var n,l;let u=async({previousCacheEntry:r})=>{try{if(!o&&C&&A&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await s(a);e.fetchMetrics=j.renderOpts.fetchMetrics;let l=j.renderOpts.pendingWaitUntil;l&&i.waitUntil&&(i.waitUntil(l),l=void 0);let u=j.renderOpts.collectedTags;if(!O)return await (0,m.sendResponse)(V,B,n,j.renderOpts.pendingWaitUntil),null;{let e=await n.blob(),t=(0,p.toNodeOutgoingHttpHeaders)(n.headers);u&&(t[f.NEXT_CACHE_TAGS_HEADER]=u),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==j.renderOpts.collectedRevalidate&&!(j.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&j.renderOpts.collectedRevalidate,i=void 0===j.renderOpts.collectedExpire||j.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:j.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:i}}}}catch(t){throw(null==r?void 0:r.isStale)&&await S.onRequestError(e,t,{routerKind:"App Router",routePath:y,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:k,isOnDemandRevalidate:C})},!1,U),t}},d=await S.handleResponse({req:e,nextConfig:R,cacheKey:$,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:x,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:A,responseGenerator:u,waitUntil:i.waitUntil,isMinimalMode:o});if(!O)return null;if((null==d||null==(n=d.value)?void 0:n.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(l=d.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});o||t.setHeader("x-nextjs-cache",C?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),N&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let E=(0,p.fromNodeOutgoingHttpHeaders)(d.value.headers);return o&&O||E.delete(f.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||E.get("Cache-Control")||E.set("Cache-Control",(0,h.getCacheControlHeader)(d.cacheControl)),await (0,m.sendResponse)(V,B,new Response(d.value.body,{headers:E,status:d.value.status||200})),null};H?await l(H):await F.withPropagatedContext(e.headers,()=>F.trace(d.BaseServerSpan.handleRequest,{spanName:`${q} ${y}`,kind:n.SpanKind.SERVER,attributes:{"http.method":q,"http.target":e.url}},l))}catch(t){if(t instanceof E.NoFallbackError||await S.onRequestError(e,t,{routerKind:"App Router",routePath:_,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:k,isOnDemandRevalidate:C})},!1,U),O)throw t;return await (0,m.sendResponse)(V,B,new Response(null,{status:500})),null}}e.s(["handler",()=>A,"patchFetch",()=>C,"routeModule",()=>S,"serverHooks",()=>U,"workAsyncStorage",()=>N,"workUnitAsyncStorage",()=>x],11093)}];

//# sourceMappingURL=_172261de._.js.map