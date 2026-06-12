/**
 * Count syllables in a word using vowel-group heuristic.
 */
export function countSyllables(word: string): number {
  if (!word) return 0;
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;

  let count = 0;
  const vowels = 'aeiouy';
  let prevVowel = false;

  for (let i = 0; i < w.length; i++) {
    const isVowel = vowels.includes(w[i]);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }

  // Adjust for silent 'e'
  if (w.endsWith('e') && !w.endsWith('le') && count > 1) count--;
  // Words like "the", "me"
  if (count === 0) count = 1;

  return count;
}

/**
 * Count syllables in a full line of text.
 */
export function countLineSyllables(line: string): number {
  if (!line.trim()) return 0;
  return line.trim().split(/\s+/).reduce((sum, word) => sum + countSyllables(word), 0);
}

/**
 * Get the ending sound of a word (last 2-3 chars) for rhyme matching.
 */
export function getEndSound(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 2) return w;
  // Return last 3 chars for better rhyme matching
  return w.slice(-3);
}

/**
 * Get the last word of a line.
 */
export function getLastWord(line: string): string {
  const words = line.trim().split(/\s+/);
  return words[words.length - 1] || '';
}

/**
 * Find rhyme groups among lines. Returns a map of line indices to color group indices.
 * Lines that rhyme (share end sounds) get the same group number.
 */
export function findRhymeGroups(lines: string[]): Map<number, number> {
  const result = new Map<number, number>();
  const endSounds = lines.map((line) => getEndSound(getLastWord(line)));

  // Group by end sound
  const groups: Record<string, number[]> = {};
  endSounds.forEach((sound, idx) => {
    if (!sound || !lines[idx].trim()) return;
    if (!groups[sound]) groups[sound] = [];
    groups[sound].push(idx);
  });

  // Assign color group indices to groups with 2+ lines
  let colorGroup = 0;
  Object.values(groups).forEach((indices) => {
    if (indices.length >= 2) {
      indices.forEach((idx) => result.set(idx, colorGroup));
      colorGroup++;
    }
  });

  return result;
}

/**
 * Rhyme highlight colors (cycle through these).
 */
export const RHYME_COLORS = [
  '#F4C430', // accent gold
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#A855F7', // purple
  '#F97316', // orange
  '#EC4899', // pink
  '#06B6D4', // cyan
];

/**
 * Section type options for the writing pad.
 */
export const SECTION_TYPES = [
  { value: 'verse', label: 'Verse' },
  { value: 'chorus', label: 'Chorus' },
  { value: 'pre-chorus', label: 'Pre-Chorus' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'hook', label: 'Hook' },
  { value: 'intro', label: 'Intro' },
  { value: 'outro', label: 'Outro' },
  { value: 'ad-lib', label: 'Ad-Lib' },
] as const;

export type SectionType = (typeof SECTION_TYPES)[number]['value'];

export interface LyricSection {
  id: string;
  type: SectionType;
  label: string;
  lines: string[];
}
