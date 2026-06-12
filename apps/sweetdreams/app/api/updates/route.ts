import { NextRequest, NextResponse } from 'next/server';

const REPO = 'colemarcuccilli/SweetDreamsMusic';
const GITHUB_API = `https://api.github.com/repos/${REPO}/commits`;

// Auto-detect which roles a commit is relevant to based on keywords
function detectTags(message: string): string[] {
  const lower = message.toLowerCase();
  const tags: Set<string> = new Set();

  // Admin keywords
  if (/\badmin\b|booking.?manager|accounting|payroll|contracts?.?viewer|kpi|overview tab|cash.?ledger|payout/i.test(lower)) tags.add('admin');

  // Engineer keywords
  if (/\bengineer\b|client.?library|session.?note|invite.*session|claim|unclaimed|record.?cash|add.?time|cash.?ledger|cash.?owed|upload.?files?|deliver/i.test(lower)) tags.add('engineer');

  // Producer keywords
  if (/\bproducer\b|beat.?(store|upload|sale|agreement|cover|price|license)|private.?sale|sell.?beats/i.test(lower)) tags.add('producer');

  // Client/artist keywords
  if (/\bdashboard\b|profile|booking|download|file|session.?prep|artist.?hub|xp|achievement|purchase|signup|login|reschedule|my.?purchases|public.?profile/i.test(lower)) tags.add('client');

  // If nothing detected, it's for everyone
  if (tags.size === 0) tags.add('all');

  return Array.from(tags);
}

// Parse commit message into title + bullet items
function parseCommitMessage(message: string): { title: string; items: string[] } {
  const lines = message.split('\n').map(l => l.trim()).filter(Boolean);

  // First line is always the title
  const title = lines[0] || 'Update';

  // Remaining lines that start with "- " or "* " are items
  const items: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('- ') || line.startsWith('* ')) {
      items.push(line.replace(/^[-*]\s*/, ''));
    } else if (line.startsWith('Co-Authored-By:')) {
      // Skip co-author lines
      continue;
    } else if (line.length > 10 && !line.startsWith('#')) {
      // Include non-trivial lines as items
      items.push(line);
    }
  }

  return { title, items };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('per_page') || '50');

  try {
    const res = await fetch(`${GITHUB_API}?per_page=${perPage}&page=${page}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'SweetDreamsMusic',
      },
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 });
    }

    const commits = await res.json();

    const updates = commits
      .filter((c: { commit: { message: string } }) => {
        const msg = c.commit.message;
        // Skip merge commits and trivial commits
        if (msg.startsWith('Merge')) return false;
        if (msg.length < 15) return false;
        return true;
      })
      .map((c: { sha: string; commit: { message: string; author: { date: string; name: string } } }) => {
        const { title, items } = parseCommitMessage(c.commit.message);
        const tags = detectTags(c.commit.message);
        return {
          id: c.sha.slice(0, 7),
          date: c.commit.author.date,
          title,
          items,
          tags,
        };
      });

    return NextResponse.json({ updates });
  } catch (err) {
    console.error('GitHub API error:', err);
    return NextResponse.json({ error: 'Failed to fetch updates' }, { status: 500 });
  }
}
