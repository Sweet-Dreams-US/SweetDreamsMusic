module.exports=[9487,e=>{"use strict";var i=e.i(58318);let s={mp3_lease:{streamingLimit:"Up to 500,000 streams across all platforms",salesLimit:"Up to 5,000 paid downloads or physical copies",musicVideos:"Unlimited music videos (may be monetized)",performances:"Unlimited live performances",radioStations:"Up to 2 radio stations",exclusive:!1,transferable:!1},trackout_lease:{streamingLimit:"Up to 1,000,000 streams across all platforms",salesLimit:"Up to 10,000 paid downloads or physical copies",musicVideos:"Unlimited music videos (may be monetized)",performances:"Unlimited live performances",radioStations:"Unlimited radio stations",exclusive:!1,transferable:!1},exclusive:{streamingLimit:"Unlimited streams",salesLimit:"Unlimited sales and distribution",musicVideos:"Unlimited music videos",performances:"Unlimited performances",radioStations:"Unlimited",exclusive:!0,transferable:!0}};function t(e){let{buyerName:t,buyerEmail:r,beatTitle:a,producerName:o,licenseType:n,amountPaid:l,purchaseDate:c,purchaseId:d}=e,m=i.BEAT_LICENSES[n],u=s[n],h=`$${(l/100).toFixed(2)}`;return`
════════════════════════════════════════════════════════
           SWEET DREAMS MUSIC — BEAT LICENSE AGREEMENT
════════════════════════════════════════════════════════

License Type: ${m.name}
Purchase ID: ${d}
Date of Agreement: ${c}

────────────────────────────────────────────────────────
PARTIES
────────────────────────────────────────────────────────
Licensor: Sweet Dreams Music LLC, Fort Wayne, IN
          (on behalf of producer "${o}")
Licensee: ${t}
          Email: ${r}

────────────────────────────────────────────────────────
BEAT INFORMATION
────────────────────────────────────────────────────────
Title: "${a}"
Producer: ${o}
Amount Paid: ${h}
Delivery Format: ${m.deliveryFormat}

────────────────────────────────────────────────────────
LICENSE GRANT
────────────────────────────────────────────────────────
${u.exclusive?"This is an EXCLUSIVE license. The beat will be removed from the store and no further licenses will be issued. All rights to the beat transfer to the Licensee, except the producer retains credit rights.":"This is a NON-EXCLUSIVE license. The producer retains the right to license this beat to other parties."}

Permitted Use:
  • Streaming: ${u.streamingLimit}
  • Sales/Distribution: ${u.salesLimit}
  • Music Videos: ${u.musicVideos}
  • Live Performances: ${u.performances}
  • Radio: ${u.radioStations}
  • Transferable: ${u.transferable?"Yes":"No — this license is non-transferable"}

────────────────────────────────────────────────────────
RESTRICTIONS
────────────────────────────────────────────────────────
1. The Licensee may NOT claim ownership of the underlying
   composition or production.
2. The Licensee may NOT resell, sublicense, or redistribute
   the beat itself (only derivative works using the beat).
3. The Licensee MUST credit the producer as
   "Prod. by ${o}" in all published works.
4. ${u.exclusive?"The producer retains the right to be credited on all works created using this beat.":"If license limits are exceeded, the Licensee must purchase an upgraded license before continued use."}

${!u.exclusive?`────────────────────────────────────────────────────────
LICENSE DURATION
────────────────────────────────────────────────────────
${i.LEASE_DURATION_DAYS[n]?`This license is valid for ${365===i.LEASE_DURATION_DAYS[n]?"1 year":"2 years"} from the date of purchase, or until the stream/distribution caps above are reached, whichever comes first.

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

${!u.exclusive?`────────────────────────────────────────────────────────
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
`.trim()}e.s(["generateLicenseText",()=>t])}];

//# sourceMappingURL=packages_core_lib_license-templates_ts_8d71ad95._.js.map