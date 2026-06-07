/**
 * scripts/site-settings-test.ts — pure unit tests for the feature/nav flag logic.
 *   npx tsx scripts/site-settings-test.ts
 *
 * Proves the locked-on guarantee + nav filtering + fail-open defaults WITHOUT
 * touching the DB or the live site. This is the security-critical core: no
 * combination of flags can hide studio sessions or the beat store.
 */
import { NAV_LINKS, FOOTER_EXTRA_LINKS } from '../lib/constants';
import {
  siteSettingsFromRow, visibleNavLinks, isHrefEnabled, DEFAULT_SITE_SETTINGS,
  type SiteSettings,
} from '../lib/site-settings';

let pass = 0, fail = 0; const fails: string[] = [];
function ok(name: string, cond: boolean) { if (cond) pass++; else { fail++; fails.push(name); console.log(`  ✗ ${name}`); } }

const ALL_OFF: SiteSettings = {
  bandsEnabled: false, eventsEnabled: false, mediaEnabled: false,
  nav: { about: false, contact: false, engineers: false, blog: false },
};
const ALL_ON = DEFAULT_SITE_SETTINGS;

console.log('\n=== site-settings logic tests ===\n');

// 1. Locked hrefs ALWAYS pass, even with everything off.
for (const href of ['/book', '/pricing', '/beats', '/sell-beats']) {
  ok(`locked ${href} stays enabled when ALL flags off`, isHrefEnabled(href, ALL_OFF) === true);
  ok(`locked ${href} stays enabled when ALL flags on`, isHrefEnabled(href, ALL_ON) === true);
}

// 2. Toggleable features honor their flag.
ok('/bands enabled when bandsEnabled', isHrefEnabled('/bands', ALL_ON) === true);
ok('/bands disabled when !bandsEnabled', isHrefEnabled('/bands', ALL_OFF) === false);
ok('/events disabled when !eventsEnabled', isHrefEnabled('/events', ALL_OFF) === false);
ok('/media disabled when !mediaEnabled', isHrefEnabled('/media', ALL_OFF) === false);
ok('/engineers disabled when nav.engineers off', isHrefEnabled('/engineers', ALL_OFF) === false);
ok('/about disabled when nav.about off', isHrefEnabled('/about', ALL_OFF) === false);
ok('/blog disabled when nav.blog off', isHrefEnabled('/blog', ALL_OFF) === false);

// 3. One feature off doesn't affect others.
const onlyBandsOff: SiteSettings = { ...ALL_ON, bandsEnabled: false };
ok('only bands off → /bands hidden', isHrefEnabled('/bands', onlyBandsOff) === false);
ok('only bands off → /events still shown', isHrefEnabled('/events', onlyBandsOff) === true);
ok('only bands off → /book still shown', isHrefEnabled('/book', onlyBandsOff) === true);

// 4. visibleNavLinks: all-off keeps ONLY the locked nav items present in NAV_LINKS.
const navAllOff = visibleNavLinks(NAV_LINKS, ALL_OFF).map((l) => l.href);
ok('navAllOff keeps /book', navAllOff.includes('/book'));
ok('navAllOff keeps /pricing', navAllOff.includes('/pricing'));
ok('navAllOff keeps /beats', navAllOff.includes('/beats'));
ok('navAllOff drops /bands', !navAllOff.includes('/bands'));
ok('navAllOff drops /events', !navAllOff.includes('/events'));
ok('navAllOff drops /media', !navAllOff.includes('/media'));
ok('navAllOff drops /engineers', !navAllOff.includes('/engineers'));
ok('navAllOff drops /about', !navAllOff.includes('/about'));
ok('navAllOff drops /contact', !navAllOff.includes('/contact'));
ok('navAllOff length == 3 (only locked)', navAllOff.length === 3);

// 5. visibleNavLinks: all-on keeps everything.
ok('navAllOn keeps all NAV_LINKS', visibleNavLinks(NAV_LINKS, ALL_ON).length === NAV_LINKS.length);

// 6. Footer extras (/blog) filtered too.
ok('footer /blog dropped when blog off', visibleNavLinks(FOOTER_EXTRA_LINKS, ALL_OFF).length === 0);
ok('footer /blog kept when blog on', visibleNavLinks(FOOTER_EXTRA_LINKS, ALL_ON).length === FOOTER_EXTRA_LINKS.length);

// 7. siteSettingsFromRow fail-open behavior.
ok('null row → all on (fail-open)', JSON.stringify(siteSettingsFromRow(null)) === JSON.stringify(ALL_ON));
ok('missing column → on', siteSettingsFromRow({}).bandsEnabled === true);
ok('null column → on (fail-open)', siteSettingsFromRow({ bands_enabled: null }).bandsEnabled === true);
ok('explicit false → off', siteSettingsFromRow({ bands_enabled: false }).bandsEnabled === false);
ok('explicit true → on', siteSettingsFromRow({ bands_enabled: true }).bandsEnabled === true);
ok('row with bands off keeps events on', siteSettingsFromRow({ bands_enabled: false }).eventsEnabled === true);
ok('nav_about_enabled false → nav.about off', siteSettingsFromRow({ nav_about_enabled: false }).nav.about === false);

console.log(`\nChecked ${pass + fail} assertions.`);
if (fail === 0) console.log(`\n✅ ALL PASS — locked features can never be hidden; nav filtering + fail-open correct.\n`);
else { console.log(`\n❌ ${fail} FAILED:`); fails.forEach((f) => console.log('  ' + f)); console.log(''); }
process.exit(fail === 0 ? 0 : 1);
