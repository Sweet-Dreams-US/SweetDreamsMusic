// scripts/band-rewards-test.ts — verifies the band-hours reward ladder + the band
// engineer split. Pure (no DB). Run: npx tsx scripts/band-rewards-test.ts
import { REWARD_RULES } from '../lib/rewards';
import { ENGINEER_BAND_SESSION_SPLIT, ENGINEER_SESSION_SPLIT } from '../lib/constants';

let pass = true;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) pass = false; };

const band = REWARD_RULES.filter((r) => r.counter === 'band_hours');
const by = (k: string) => band.find((r) => r.rule_key === k)!;

ok('7 band_hours rules', band.length === 7);
ok('all band track', band.every((r) => r.track === 'band'));

// The ladder Cole specified.
ok('16h → free short-form video', by('band_sh_16').threshold === 16 && by('band_sh_16').reward_type === 'free_short_video');
ok('24h → 3 free (mixing) hours', by('band_sh_24').threshold === 24 && by('band_sh_24').reward_type === 'free_hours' && by('band_sh_24').reward_value === 3);
ok('40h → free photo session',    by('band_sh_40').threshold === 40 && by('band_sh_40').reward_type === 'free_photo_session');
ok('60h → free 4-hour session',   by('band_sh_60').threshold === 60 && by('band_sh_60').reward_type === 'free_hours' && by('band_sh_60').reward_value === 4);
ok('80h → free Band Sweet Spot',  by('band_sh_80').threshold === 80 && by('band_sh_80').reward_type === 'free_sweet_spot');
ok('120h → free music video',     by('band_sh_120').threshold === 120 && by('band_sh_120').reward_type === 'free_music_video');
ok('150h → free full day (8h)',   by('band_sh_150').threshold === 150 && by('band_sh_150').reward_type === 'free_hours' && by('band_sh_150').reward_value === 8);
ok('ladder strictly ascending',   band.map((r) => r.threshold).every((t, i, a) => i === 0 || t > a[i - 1]));

// Band engineer split: 70% (higher than the 60% solo split).
ok('band engineer split is 70%', ENGINEER_BAND_SESSION_SPLIT === 0.70);
ok('band split > solo split',    ENGINEER_BAND_SESSION_SPLIT > ENGINEER_SESSION_SPLIT);

// Margin sanity: at 70% on a $110/hr (4hr) band, the studio keeps MORE per hour
// than on a $65/hr solo session at 60% — the case for paying bands more.
const bandStudioPerHr = 110 * (1 - ENGINEER_BAND_SESSION_SPLIT); // $33
const soloStudioPerHr = 65 * (1 - ENGINEER_SESSION_SPLIT);        // $26
ok('studio nets more/hr on a 4hr band than solo (margin holds)', bandStudioPerHr > soloStudioPerHr);

// Band spend ladder is untouched (4 rungs).
ok('band_spend ladder intact (4 rungs)', REWARD_RULES.filter((r) => r.counter === 'band_spend').length === 4);

console.log('');
console.log(pass ? '✅ BAND REWARDS + SPLIT VERIFIED' : '❌ FAILURES ABOVE');
process.exit(pass ? 0 : 1);
