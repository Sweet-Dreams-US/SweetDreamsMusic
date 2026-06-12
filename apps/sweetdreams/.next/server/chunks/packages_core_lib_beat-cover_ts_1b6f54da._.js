module.exports=[37680,t=>{"use strict";var e=t.i(58318);function i(t){let i,a,o,r,l=e.BEAT_GENRES.find(e=>e.value===t),s=l?.bg||"#1a1a1a",n=l?.text||"#F4C430",c=(a=Math.max(0,Math.min(255,((i=parseInt(s.replace("#",""),16))>>16&255)+-20)),o=Math.max(0,Math.min(255,(i>>8&255)+-20)),r=Math.max(0,Math.min(255,(255&i)+-20)),`#${(a<<16|o<<8|r).toString(16).padStart(6,"0")}`);return`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${s}" />
      <stop offset="100%" style="stop-color:${c}" />
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)" />
  <line x1="0" y1="400" x2="800" y2="400" stroke="${n}" stroke-opacity="0.06" stroke-width="1" />
  <line x1="400" y1="0" x2="400" y2="800" stroke="${n}" stroke-opacity="0.06" stroke-width="1" />
  <rect x="50" y="50" width="700" height="700" fill="none" stroke="${n}" stroke-opacity="0.08" stroke-width="1" />
  <text x="400" y="360" font-family="Anton,'Impact','Arial Black',sans-serif" font-size="120" font-weight="900" fill="${n}" text-anchor="middle" letter-spacing="8" opacity="0.95">SWEET</text>
  <text x="400" y="490" font-family="Anton,'Impact','Arial Black',sans-serif" font-size="120" font-weight="900" fill="${n}" text-anchor="middle" letter-spacing="8" opacity="0.95">DREAMS</text>
  <rect x="250" y="530" width="300" height="3" fill="${n}" opacity="0.4" />
  ${t?`<text x="400" y="580" font-family="monospace" font-size="20" font-weight="600" fill="${n}" text-anchor="middle" opacity="0.4" letter-spacing="6">${t.toUpperCase().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}</text>`:""}
</svg>`}t.s(["generateBeatCover",()=>i])}];

//# sourceMappingURL=packages_core_lib_beat-cover_ts_1b6f54da._.js.map