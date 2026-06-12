module.exports=[96904,e=>{"use strict";var t=e.i(58318);function r(e){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(e/100)}function a(e){let t="string"==typeof e?Number(e):e;if(!Number.isFinite(t)||t<=0)return"—";let r=Math.round(60*t);if(r%15!=0)return`${t.toFixed(2)}hr`;let a=Math.floor(r/60),i=r%60;return 0===a?`${i}min`:0===i?`${a}hr`:`${a}hr ${i}min`}function i(e){return 4===e||8===e||24===e}function s(e,r){return e?t.SUPER_ADMINS.includes(e.toLowerCase())?"admin":"engineer"===r?"engineer":"media_manager"===r?"media_manager":"agent"===r?"agent":"user":"user"}function n(e){let[t,r]=e.split(":").map(Number);return t+(r||0)/60}e.s(["formatCents",()=>r,"formatDuration",()=>a,"getUserRole",()=>s,"isSelfServeBandHours",()=>i,"parseTimeSlot",()=>n])},36028,e=>{"use strict";var t=e.i(58318);function r(e,t,r,a){if(!e)return"";let i=new Date(e);return isNaN(i.getTime())?"":i.toLocaleString("en-US",{...t,...r,timeZone:a})}function a(e,t){return r(e,{hour:"numeric",minute:"2-digit"},t,"UTC")}function i(e,t){return r(e,{month:"short",day:"numeric",year:"numeric"},t,"UTC")}function s(e,a){return r(e,{hour:"numeric",minute:"2-digit"},a,t.TIMEZONE)}function n(e,a){return r(e,{month:"short",day:"numeric",year:"numeric"},a,t.TIMEZONE)}function o(e,a){return r(e,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"},a,t.TIMEZONE)}function l(e){var r;let a,i,s;if(!e)return null;let n=e.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);if(!n)return null;let o=Date.UTC(Number(n[1]),Number(n[2])-1,Number(n[3]),Number(n[4]),Number(n[5])),l=(r=new Date(o),a=new Intl.DateTimeFormat("en-US",{timeZone:t.TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1}).formatToParts(r),24===(s=(i=e=>Number(a.find(t=>t.type===e)?.value))("hour"))&&(s=0),Date.UTC(i("year"),i("month")-1,i("day"),s,i("minute"),i("second"))-r.getTime());return new Date(o-l).toISOString()}e.s(["fmtSessionDate",()=>i,"fmtSessionTime",()=>a,"fmtStampDate",()=>n,"fmtStampDateTime",()=>o,"fmtStampTime",()=>s,"studioInputToUtcISO",()=>l])},37161,e=>{"use strict";var t=e.i(58318);let r={instagram:"https://www.instagram.com/sweetdreamsmusic",youtube:"https://www.youtube.com/@sweetdreamsmusic",tiktok:"https://www.tiktok.com/@sweetdreamsmusic"};function a(){return{name:t.BRAND.name,legalName:t.BRAND.legalName,tagline:t.BRAND.tagline,phone:t.BRAND.phone,email:t.BRAND.email,address:{...t.BRAND.address},socials:{...r},fromEmail:"studio@sweetdreamsmusic.com",fromName:t.BRAND.name}}function i(e){if(!e)return a();let t=a();return{name:e.name??t.name,legalName:e.legal_name??t.legalName,tagline:e.tagline??t.tagline,phone:e.phone??t.phone,email:e.email??t.email,address:{street:e.addr_street??t.address.street,city:e.addr_city??t.address.city,state:e.addr_state??t.address.state,zip:e.addr_zip??t.address.zip,country:e.addr_country??t.address.country},socials:e.socials&&Object.keys(e.socials).length>0?e.socials:t.socials,fromEmail:e.from_email||t.fromEmail,fromName:e.from_name||t.fromName}}e.s(["brandFromConstants",()=>a,"brandFromRow",()=>i,"cityState",0,e=>`${e.address.city}, ${e.address.state}`])},63601,e=>{"use strict";var t=e.i(46e3);async function r(e){let r=(0,t.createServiceClient)();if(e.mediaBookingId){let{data:t}=await r.from("message_threads").select("id").eq("kind","media_booking").eq("media_booking_id",e.mediaBookingId).maybeSingle();if(t)return t.id;let{data:a,error:i}=await r.from("message_threads").insert({kind:"media_booking",media_booking_id:e.mediaBookingId,subject:"Booking conversation"}).select("id").single();return i||!a?(console.error("[messaging-mirror] could not create booking thread:",i),null):a.id}let a=e.userId;if(!a&&e.userEmail){let{data:t}=await r.from("profiles").select("user_id").eq("email",e.userEmail.toLowerCase()).maybeSingle();if(!(a=t?.user_id))return console.warn("[messaging-mirror] no profile found for email:",e.userEmail),null}if(a){let{data:e}=await r.from("message_threads").select("id").eq("kind","sweet_dreams").eq("owner_user_id",a).maybeSingle();if(e)return e.id;let{data:t,error:i}=await r.from("message_threads").insert({kind:"sweet_dreams",owner_user_id:a,subject:"Sweet Dreams Music"}).select("id").single();return i||!t?(console.error("[messaging-mirror] could not create Sweet Dreams thread:",i),null):(await r.from("message_thread_participants").insert({thread_id:t.id,user_id:a,role:"owner"}),t.id)}return null}async function a(e){try{let a=await r(e);if(!a)return;let i=(0,t.createServiceClient)(),s=e.subject?`${e.subject}

${e.body}`:e.body,{error:n}=await i.from("messages").insert({thread_id:a,author_user_id:null,author_role:"system",kind:e.kind,body:s,attachments:e.attachments??[]});n&&console.error("[messaging-mirror] insert failed:",n)}catch(e){console.error("[messaging-mirror] unexpected error:",e)}}e.s(["mirrorToThread",()=>a])},9487,e=>{"use strict";var t=e.i(58318);let r={mp3_lease:{streamingLimit:"Up to 500,000 streams across all platforms",salesLimit:"Up to 5,000 paid downloads or physical copies",musicVideos:"Unlimited music videos (may be monetized)",performances:"Unlimited live performances",radioStations:"Up to 2 radio stations",exclusive:!1,transferable:!1},trackout_lease:{streamingLimit:"Up to 1,000,000 streams across all platforms",salesLimit:"Up to 10,000 paid downloads or physical copies",musicVideos:"Unlimited music videos (may be monetized)",performances:"Unlimited live performances",radioStations:"Unlimited radio stations",exclusive:!1,transferable:!1},exclusive:{streamingLimit:"Unlimited streams",salesLimit:"Unlimited sales and distribution",musicVideos:"Unlimited music videos",performances:"Unlimited performances",radioStations:"Unlimited",exclusive:!0,transferable:!0}};function a(e){let{buyerName:a,buyerEmail:i,beatTitle:s,producerName:n,licenseType:o,amountPaid:l,purchaseDate:d,purchaseId:u}=e,c=t.BEAT_LICENSES[o],m=r[o],p=`$${(l/100).toFixed(2)}`;return`
════════════════════════════════════════════════════════
           SWEET DREAMS MUSIC — BEAT LICENSE AGREEMENT
════════════════════════════════════════════════════════

License Type: ${c.name}
Purchase ID: ${u}
Date of Agreement: ${d}

────────────────────────────────────────────────────────
PARTIES
────────────────────────────────────────────────────────
Licensor: Sweet Dreams Music LLC, Fort Wayne, IN
          (on behalf of producer "${n}")
Licensee: ${a}
          Email: ${i}

────────────────────────────────────────────────────────
BEAT INFORMATION
────────────────────────────────────────────────────────
Title: "${s}"
Producer: ${n}
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
   "Prod. by ${n}" in all published works.
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
`.trim()}e.s(["generateLicenseText",()=>a])},29579,e=>{"use strict";var t=e.i(47909),r=e.i(74017),a=e.i(96250),i=e.i(59756),s=e.i(61916),n=e.i(74677),o=e.i(69741),l=e.i(16795),d=e.i(87718),u=e.i(95169),c=e.i(47587),m=e.i(66012),p=e.i(70101),h=e.i(26937),f=e.i(10372),g=e.i(93695);e.i(52474);var b=e.i(5232),y=e.i(89171),w=e.i(46e3),_=e.i(9487),v=e.i(77528),E=e.i(58318);async function S(e,{params:t}){let{token:r}=await t;if(!r)return y.NextResponse.json({error:"Token required"},{status:400});let a=await (0,w.createClient)(),{data:{user:i}}=await a.auth.getUser();if(!i)return y.NextResponse.json({error:"Login required to sign agreements"},{status:401});let{data:s}=await a.from("profiles").select("id, display_name").eq("user_id",i.id).single(),n=s?.display_name||i.email?.split("@")[0]||"Buyer",o=(0,w.createServiceClient)(),{data:l,error:d}=await o.from("private_beat_sales").select("*").eq("token",r).single();if(d||!l)return y.NextResponse.json({error:"Sale not found"},{status:404});if("pending"!==l.status)return y.NextResponse.json({error:`Sale is already ${l.status}`},{status:400});let u=e.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||e.headers.get("x-real-ip")||"unknown",c=e.headers.get("user-agent")||"unknown",m=l.license_type,p=E.BEAT_LICENSES[m],h=new Date,f=(0,_.generateLicenseText)({buyerName:n,buyerEmail:i.email||l.buyer_email,beatTitle:l.beat_title,producerName:l.beat_producer,licenseType:m,amountPaid:l.amount,purchaseDate:h.toISOString().split("T")[0],purchaseId:l.id}),g={signed_at:h.toISOString(),agreement_text:f,agreement_ip:u,agreement_user_agent:c,status:"signed"};if(!l.requires_payment){let{data:e,error:t}=await o.from("beat_purchases").insert({beat_id:l.beat_id||null,buyer_id:i.id,buyer_email:i.email||l.buyer_email,license_type:l.license_type,amount_paid:l.amount,payment_method:l.payment_method||"private_sale",private_sale_id:l.id}).select("id").single();if(t)return console.error("Failed to create purchase record:",t),y.NextResponse.json({error:"Failed to complete sale"},{status:500});g.status="completed",g.purchase_id=e.id,g.completed_at=h.toISOString(),"exclusive"===m&&l.beat_id&&await o.from("beats").update({status:"sold_exclusive",exclusive_sold_at:h.toISOString()}).eq("id",l.beat_id);let{error:a}=await o.from("private_beat_sales").update(g).eq("id",l.id);return a?(console.error("Failed to update sale:",a),y.NextResponse.json({error:"Failed to update sale"},{status:500})):(await (0,v.sendPrivateBeatSaleComplete)(l.buyer_email,{buyerName:l.buyer_name,beatTitle:l.beat_title,producerName:l.beat_producer,licenseType:p.name,amount:l.amount,token:r}),y.NextResponse.json({status:"completed",downloadUrl:`/api/beats/private-sale/${r}/download`}))}let{error:b}=await o.from("private_beat_sales").update(g).eq("id",l.id);return b?(console.error("Failed to update sale:",b),y.NextResponse.json({error:"Failed to update sale"},{status:500})):y.NextResponse.json({status:"signed",checkoutUrl:`/api/beats/private-sale/${r}/checkout`})}e.s(["POST",()=>S],91492);var R=e.i(91492);let T=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/beats/private-sale/[token]/sign/route",pathname:"/api/beats/private-sale/[token]/sign",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/apps/sweetdreams/app/api/beats/private-sale/[token]/sign/route.ts",nextConfigOutput:"",userland:R}),{workAsyncStorage:N,workUnitAsyncStorage:x,serverHooks:C}=T;function A(){return(0,a.patchFetch)({workAsyncStorage:N,workUnitAsyncStorage:x})}async function I(e,t,a){T.isDev&&(0,i.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let y="/api/beats/private-sale/[token]/sign/route";y=y.replace(/\/index$/,"")||"/";let w=await T.prepare(e,t,{srcPage:y,multiZoneDraftMode:!1});if(!w)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:_,params:v,nextConfig:E,parsedUrl:S,isDraftMode:R,prerenderManifest:N,routerServerContext:x,isOnDemandRevalidate:C,revalidateOnlyGenerated:A,resolvedPathname:I,clientReferenceManifest:U,serverActionsManifest:D}=w,k=(0,o.normalizeAppPath)(y),L=!!(N.dynamicRoutes[k]||N.routes[I]),$=async()=>((null==x?void 0:x.render404)?await x.render404(e,t,S,!1):t.end("This page could not be found"),null);if(L&&!R){let e=!!N.routes[I],t=N.dynamicRoutes[k];if(t&&!1===t.fallback&&!e){if(E.experimental.adapterPath)return await $();throw new g.NoFallbackError}}let O=null;!L||T.isDev||R||(O="/index"===(O=I)?"/":O);let P=!0===T.isDev||!L,M=L&&!P;D&&U&&(0,n.setManifestsSingleton)({page:y,clientReferenceManifest:U,serverActionsManifest:D});let F=e.method||"GET",q=(0,s.getTracer)(),B=q.getActiveScopeSpan(),j={params:v,prerenderManifest:N,renderOpts:{experimental:{authInterrupts:!!E.experimental.authInterrupts},cacheComponents:!!E.cacheComponents,supportsDynamicResponse:P,incrementalCache:(0,i.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:E.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,i)=>T.onRequestError(e,t,a,i,x)},sharedContext:{buildId:_}},H=new l.NodeNextRequest(e),V=new l.NodeNextResponse(t),K=d.NextRequestAdapter.fromNodeNextRequest(H,(0,d.signalFromNodeResponse)(t));try{let n=async e=>T.handle(K,j).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=q.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==u.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route");if(a){let t=`${F} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t)}else e.updateName(`${F} ${y}`)}),o=!!(0,i.getRequestMeta)(e,"minimalMode"),l=async i=>{var s,l;let d=async({previousCacheEntry:r})=>{try{if(!o&&C&&A&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await n(i);e.fetchMetrics=j.renderOpts.fetchMetrics;let l=j.renderOpts.pendingWaitUntil;l&&a.waitUntil&&(a.waitUntil(l),l=void 0);let d=j.renderOpts.collectedTags;if(!L)return await (0,m.sendResponse)(H,V,s,j.renderOpts.pendingWaitUntil),null;{let e=await s.blob(),t=(0,p.toNodeOutgoingHttpHeaders)(s.headers);d&&(t[f.NEXT_CACHE_TAGS_HEADER]=d),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==j.renderOpts.collectedRevalidate&&!(j.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&j.renderOpts.collectedRevalidate,a=void 0===j.renderOpts.collectedExpire||j.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:j.renderOpts.collectedExpire;return{value:{kind:b.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await T.onRequestError(e,t,{routerKind:"App Router",routePath:y,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:C})},!1,x),t}},u=await T.handleResponse({req:e,nextConfig:E,cacheKey:O,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:N,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:A,responseGenerator:d,waitUntil:a.waitUntil,isMinimalMode:o});if(!L)return null;if((null==u||null==(s=u.value)?void 0:s.kind)!==b.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==u||null==(l=u.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});o||t.setHeader("x-nextjs-cache",C?"REVALIDATED":u.isMiss?"MISS":u.isStale?"STALE":"HIT"),R&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let g=(0,p.fromNodeOutgoingHttpHeaders)(u.value.headers);return o&&L||g.delete(f.NEXT_CACHE_TAGS_HEADER),!u.cacheControl||t.getHeader("Cache-Control")||g.get("Cache-Control")||g.set("Cache-Control",(0,h.getCacheControlHeader)(u.cacheControl)),await (0,m.sendResponse)(H,V,new Response(u.value.body,{headers:g,status:u.value.status||200})),null};B?await l(B):await q.withPropagatedContext(e.headers,()=>q.trace(u.BaseServerSpan.handleRequest,{spanName:`${F} ${y}`,kind:s.SpanKind.SERVER,attributes:{"http.method":F,"http.target":e.url}},l))}catch(t){if(t instanceof g.NoFallbackError||await T.onRequestError(e,t,{routerKind:"App Router",routePath:k,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:C})},!1,x),L)throw t;return await (0,m.sendResponse)(H,V,new Response(null,{status:500})),null}}e.s(["handler",()=>I,"patchFetch",()=>A,"routeModule",()=>T,"serverHooks",()=>C,"workAsyncStorage",()=>N,"workUnitAsyncStorage",()=>x],29579)},51655,e=>{e.v(e=>Promise.resolve().then(()=>e(46e3)))}];

//# sourceMappingURL=_434b4a1f._.js.map