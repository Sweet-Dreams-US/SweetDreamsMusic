// lib/blog/markdown.ts
//
// Turns a post body (markdown) into HTML for the blog page, and collects the
// `##` headings that feed the contents panel. Pure functions, no I/O.
//
// Supported: paragraphs, ## ### #### headings, bullet and numbered lists (one
// level of nesting and more), blockquotes, tables, fenced code, images, rules,
// bold, italic, inline code, links, and the two callouts from the blog format:
//
//   :::tip Title        :::note Title
//   text                text
//   [Button label](/contact)
//   :::                 :::
//
// A link inside a tip is always rendered as a button under the tip text, never
// as an inline link. Every piece of text is HTML escaped and every URL is
// checked, so a post body can never inject markup.
//
// Styling lives in the `.blog-prose` rules in app/globals.css.

export interface PostHeading {
  id: string;
  text: string;
}

export interface RenderedPost {
  html: string;
  headings: PostHeading[];
}

/* ------------------------------------------------------------------ utils */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Allow only relative, anchor, http(s), mailto and tel URLs. */
export function safeUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (u.startsWith('//')) return null;
  if (u.startsWith('/') || u.startsWith('#')) return u;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  return null;
}

function isExternal(u: string): boolean {
  return /^https?:/i.test(u);
}

function anchor(label: string, href: string, cls: string): string {
  const url = safeUrl(href);
  if (!url) return label;
  const ext = isExternal(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${esc(url)}"${cls ? ` class="${cls}"` : ''}${ext}>${label}</a>`;
}

/** Strip inline markdown so a heading can be used as plain text. */
function plain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1')
    .trim();
}

function slugify(text: string): string {
  return (
    plain(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/* ----------------------------------------------------------------- inline */

const LINK_URL = String.raw`((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?`;
const LINK_RE = new RegExp(String.raw`^\[([^\]]+)\]\(${LINK_URL}\)`);
const IMG_RE = new RegExp(String.raw`^!\[([^\]]*)\]\(${LINK_URL}\)`);

function inline(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];
    let m: RegExpMatchArray | null;

    if (ch === '\\' && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!|>]/.test(src[i + 1])) {
      out += esc(src[i + 1]);
      i += 2;
      continue;
    }
    if (ch === '`' && (m = rest.match(/^`([^`]+)`/))) {
      out += `<code>${esc(m[1])}</code>`;
      i += m[0].length;
      continue;
    }
    if (ch === '!' && (m = rest.match(IMG_RE))) {
      const url = safeUrl(m[2]);
      if (url) out += `<img src="${esc(url)}" alt="${esc(m[1])}" loading="lazy" />`;
      i += m[0].length;
      continue;
    }
    if (ch === '[' && (m = rest.match(LINK_RE))) {
      out += anchor(inline(m[1]), m[2], '');
      i += m[0].length;
      continue;
    }
    if ((ch === '*' || ch === '_') && (m = rest.match(/^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/))) {
      out += `<strong>${inline(m[2])}</strong>`;
      i += m[0].length;
      continue;
    }
    if (ch === '*' && (m = rest.match(/^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/))) {
      out += `<em>${inline(m[1])}</em>`;
      i += m[0].length;
      continue;
    }
    if (
      ch === '_' &&
      (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1])) &&
      (m = rest.match(/^_(?=[^\s_])([\s\S]*?[^\s_])_(?![A-Za-z0-9_])/))
    ) {
      out += `<em>${inline(m[1])}</em>`;
      i += m[0].length;
      continue;
    }
    out += esc(ch);
    i++;
  }
  return out;
}

/* ----------------------------------------------------------------- blocks */

interface Ctx {
  headings: PostHeading[];
  usedIds: Map<string, number>;
  title: string;
  /** false inside callouts: no headings are collected there */
  top: boolean;
}

const ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE_RE = /^\s*```/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const CALLOUT_OPEN_RE = /^\s*:::(tip|note)\b[ \t]*(.*)$/i;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isBlank(l: string): boolean {
  return l.trim() === '';
}

function splitCells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (t[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += t[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  if (isBlank(l)) return true;
  if (HEADING_RE.test(l) || FENCE_RE.test(l) || HR_RE.test(l) || CALLOUT_OPEN_RE.test(l)) return true;
  if (ITEM_RE.test(l) || /^\s*>/.test(l)) return true;
  if (l.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) return true;
  return false;
}

function uniqueId(ctx: Ctx, text: string): string {
  const base = slugify(text);
  const n = (ctx.usedIds.get(base) ?? 0) + 1;
  ctx.usedIds.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

function parseList(lines: string[], start: number, baseIndent: number): { html: string; next: number } {
  const first = lines[start].match(ITEM_RE)!;
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items: { text: string; nested: string }[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      const nxt = j < lines.length ? lines[j].match(ITEM_RE) : null;
      if (nxt && nxt[1].length >= baseIndent && (nxt[1].length > baseIndent || /\d/.test(nxt[2]) === ordered)) {
        i = j;
        continue;
      }
      break;
    }
    const m = line.match(ITEM_RE);
    if (m) {
      const indent = m[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent && items.length) {
        const sub = parseList(lines, i, indent);
        items[items.length - 1].nested += sub.html;
        i = sub.next;
        continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ text: m[3], nested: '' });
      i++;
      continue;
    }
    if (/^\s{2,}\S/.test(line) && items.length) {
      items[items.length - 1].text += ' ' + line.trim();
      i++;
      continue;
    }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const body = items.map((it) => `<li>${inline(it.text)}${it.nested}</li>`).join('');
  return { html: `<${tag}${startAttr}>${body}</${tag}>`, next: i };
}

/** Pull links out of a tip's text. Each becomes a button under the text. */
function extractTipLinks(raw: string): { text: string; links: { label: string; href: string }[] } {
  const links: { label: string; href: string }[] = [];
  const text = raw
    .split('\n')
    .map((line) => {
      const re = new RegExp(String.raw`\[([^\]]+)\]\(${LINK_URL}\)`, 'g');
      const linkCount = (line.match(re) ?? []).length;
      let result = '';
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const label = plain(m[1]);
        const href = m[2];
        if (safeUrl(href) && !links.some((l) => l.href === href && l.label === label)) links.push({ label, href });
        const after = line.slice(m.index + m[0].length);
        // Only a lone link at the end of a line is dropped from the text. With
        // several links in one line the sentence keeps every label, so it still reads.
        const atEnd = linkCount === 1 && /^[\s.!?)]*$/.test(after);
        result += line.slice(last, m.index);
        if (atEnd) {
          // Link closes the line: it becomes the button, the text keeps what came before.
          result = result.replace(/[\s:;,]+$/, '');
          if (result) result += after.trim();
          last = line.length;
          break;
        }
        result += label; // mid sentence: keep the words, drop the link
        last = m.index + m[0].length;
      }
      result += line.slice(last);
      return result.replace(/\s+$/, '');
    })
    .join('\n');
  return { text, links };
}

function renderCallout(kind: 'tip' | 'note', title: string, inner: string[], ctx: Ctx): string {
  let bodyLines = inner;
  let links: { label: string; href: string }[] = [];
  if (kind === 'tip') {
    const extracted = extractTipLinks(inner.join('\n'));
    bodyLines = extracted.text.split('\n');
    links = extracted.links;
  }
  const body = renderBlocks(bodyLines, { ...ctx, top: false });
  const label = kind === 'tip' ? 'Tip' : 'Note';
  const cleanTitle = plain(title);
  const buttons = links.length
    ? `<div class="blog-callout-actions">${links
        .map((l) => anchor(esc(l.label), l.href, 'blog-callout-btn'))
        .join('')}</div>`
    : '';
  return (
    `<aside class="blog-callout blog-callout-${kind}" aria-label="${esc(label + (cleanTitle ? ': ' + cleanTitle : ''))}">` +
    `<p class="blog-callout-kicker">${label}</p>` +
    (cleanTitle ? `<p class="blog-callout-title">${inline(title)}</p>` : '') +
    `<div class="blog-callout-body">${body}</div>${buttons}</aside>`
  );
}

function renderBlocks(lines: string[], ctx: Ctx): string {
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Callouts
    const co = line.match(CALLOUT_OPEN_RE);
    if (co) {
      const inner: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') {
        inner.push(lines[i]);
        i++;
      }
      i++; // closing :::
      html.push(renderCallout(co[1].toLowerCase() as 'tip' | 'note', co[2].trim(), inner, ctx));
      continue;
    }

    // Fenced code
    if (FENCE_RE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    // Headings
    const h = line.match(HEADING_RE);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      i++;
      if (level === 1) {
        // The page already shows the title as its h1. Drop a repeat of it.
        if (plain(text).toLowerCase() === ctx.title.trim().toLowerCase()) continue;
        html.push(`<h2 class="blog-subhead">${inline(text)}</h2>`);
        continue;
      }
      if (level === 2) {
        if (ctx.top) {
          const id = uniqueId(ctx, text);
          ctx.headings.push({ id, text: plain(text) });
          html.push(`<h2 id="${id}">${inline(text)}</h2>`);
        } else {
          html.push(`<h3>${inline(text)}</h3>`);
        }
        continue;
      }
      html.push(`<h${level === 3 ? 3 : 4}>${inline(text)}</h${level === 3 ? 3 : 4}>`);
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(line)) {
      html.push('<hr />');
      i++;
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitCells(line);
      const aligns = splitCells(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left',
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        rows.push(splitCells(lines[i]));
        i++;
      }
      const th = head.map((c, k) => `<th style="text-align:${aligns[k] ?? 'left'}">${inline(c)}</th>`).join('');
      const tr = rows
        .map(
          (r) =>
            `<tr>${head
              .map((_, k) => `<td style="text-align:${aligns[k] ?? 'left'}">${inline(r[k] ?? '')}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      html.push(`<div class="blog-table"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${renderBlocks(q, { ...ctx, top: false })}</blockquote>`);
      continue;
    }

    // Lists
    const li = line.match(ITEM_RE);
    if (li) {
      const res = parseList(lines, i, li[1].length);
      html.push(res.html);
      i = res.next;
      continue;
    }

    // Image on its own line
    const img = line.trim().match(new RegExp(String.raw`^!\[([^\]]*)\]\(${LINK_URL}\)$`));
    if (img) {
      const url = safeUrl(img[2]);
      if (url) {
        const cap = img[1].trim();
        html.push(
          `<figure><img src="${esc(url)}" alt="${esc(cap)}" loading="lazy" />${
            cap ? `<figcaption>${esc(cap)}</figcaption>` : ''
          }</figure>`,
        );
      }
      i++;
      continue;
    }

    // Paragraph: gather soft wrapped lines
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !startsBlock(lines, i)) {
      para.push(lines[i].trim());
      i++;
    }
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return html.join('\n');
}

/** Render a post body. `title` lets a repeated top level heading be dropped. */
export function renderPostBody(body: string, opts: { title?: string } = {}): RenderedPost {
  const ctx: Ctx = { headings: [], usedIds: new Map(), title: opts.title ?? '', top: true };
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const html = renderBlocks(lines, ctx);
  return { html, headings: ctx.headings };
}
