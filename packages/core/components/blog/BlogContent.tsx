'use client';

import { useMemo } from 'react';

interface BlogContentProps {
  content: string;
}

function generateId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseInline(text: string): string {
  let result = escapeHtml(text);

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-black">$1</strong>');

  // Italic: *text*
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em class="italic">$1</em>');

  // Inline code: `code`
  result = result.replace(
    /`(.+?)`/g,
    '<code class="bg-[#F4C430]/10 text-black px-2 py-0.5 text-sm font-mono rounded border border-[#F4C430]/20">$1</code>'
  );

  // Links: [text](url)
  result = result.replace(
    /\[(.+?)\]\((.+?)\)/g,
    (_, linkText, url) => {
      const isInternal = url.startsWith('/');
      const target = isInternal ? '' : ' target="_blank" rel="noopener noreferrer"';
      return `<a href="${url}" class="text-[#F4C430] hover:underline font-semibold"${target}>${linkText}</a>`;
    }
  );

  return result;
}

function renderMarkdown(content: string): string {
  const lines = content.split('\n');
  const html: string[] = [];
  let inList = false;
  let inOrderedList = false;
  let inBlockquote = false;
  let inCallout = false;
  let calloutContent: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let tableAlignments: string[] = [];

  function closeList() {
    if (inList) { html.push('</ul>'); inList = false; }
    if (inOrderedList) { html.push('</ol>'); inOrderedList = false; }
  }

  function closeBlockquote() {
    if (inBlockquote) { html.push('</blockquote>'); inBlockquote = false; }
  }

  function closeCallout() {
    if (inCallout) {
      html.push(
        `<div class="bg-gradient-to-r from-[#F4C430]/10 to-[#F4C430]/5 border-l-4 border-[#F4C430] p-6 my-8 rounded-r-lg">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 bg-[#F4C430] rounded-full flex items-center justify-center text-black text-xs font-bold">★</span>
            <p class="font-mono text-xs font-bold tracking-[0.2em] uppercase text-[#F4C430]">Sweet Dreams Recommends</p>
          </div>
          <div class="text-black/80 text-sm leading-relaxed space-y-2">${calloutContent.map(l => `<p>${parseInline(l)}</p>`).join('')}</div>
        </div>`
      );
      inCallout = false;
      calloutContent = [];
    }
  }

  function closeTable() {
    if (!inTable || tableRows.length === 0) { inTable = false; return; }

    const headerRow = tableRows[0];
    const dataRows = tableRows.slice(1);

    let tableHtml = '<div class="my-8 overflow-x-auto rounded-lg border border-black/10">';
    tableHtml += '<table class="w-full border-collapse">';

    // Header
    tableHtml += '<thead><tr class="bg-black text-white">';
    headerRow.forEach((cell, i) => {
      const align = tableAlignments[i] || 'left';
      tableHtml += `<th class="px-4 py-3 text-left font-mono text-xs font-bold uppercase tracking-wider" style="text-align:${align}">${parseInline(cell.trim())}</th>`;
    });
    tableHtml += '</tr></thead>';

    // Body
    tableHtml += '<tbody>';
    dataRows.forEach((row, rowIdx) => {
      const bg = rowIdx % 2 === 0 ? 'bg-white' : 'bg-black/[0.02]';
      tableHtml += `<tr class="${bg} border-b border-black/5 hover:bg-[#F4C430]/5 transition-colors">`;
      row.forEach((cell, i) => {
        const align = tableAlignments[i] || 'left';
        tableHtml += `<td class="px-4 py-3 font-mono text-sm text-black/70" style="text-align:${align}">${parseInline(cell.trim())}</td>`;
      });
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table></div>';

    html.push(tableHtml);
    inTable = false;
    tableRows = [];
    tableAlignments = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Callout blocks: :::recommend ... :::
    if (line.trim() === ':::recommend') {
      closeList(); closeBlockquote(); closeTable();
      inCallout = true;
      calloutContent = [];
      continue;
    }
    if (line.trim() === ':::' && inCallout) {
      closeCallout();
      continue;
    }
    if (inCallout) {
      if (line.trim()) calloutContent.push(line.trim());
      continue;
    }

    // Table detection: line contains | with content between pipes
    const trimmedLine = line.trim();
    const pipeCount = (trimmedLine.match(/\|/g) || []).length;
    const isTableRow = pipeCount >= 2 && trimmedLine.includes('|') && !trimmedLine.startsWith('#');
    const isSeparatorRow = /^[\s|:-]+$/.test(trimmedLine) && trimmedLine.includes('---');

    if (isTableRow || isSeparatorRow) {
      if (!inTable) {
        closeList(); closeBlockquote();
        inTable = true;
        tableRows = [];
        tableAlignments = [];
      }

      if (isSeparatorRow) {
        // Parse alignments from separator row like |:---|:---:|---:|
        const cells = trimmedLine.replace(/^\||\|$/g, '').split('|');
        tableAlignments = cells.map(cell => {
          const trimmed = cell.trim();
          if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
          if (trimmed.endsWith(':')) return 'right';
          return 'left';
        });
        continue;
      }

      // Data row
      const cells = trimmedLine.replace(/^\||\|$/g, '').split('|');
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      closeTable();
    }

    // Empty line
    if (line.trim() === '') {
      closeList(); closeBlockquote();
      continue;
    }

    // Headings
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      closeList(); closeBlockquote();
      const text = h3Match[1];
      const id = generateId(text);
      html.push(`<h3 id="${id}" class="text-lg sm:text-xl font-bold mt-10 mb-4 scroll-mt-24 flex items-center gap-3"><span class="w-1.5 h-6 bg-[#F4C430] rounded-full inline-block"></span>${parseInline(text)}</h3>`);
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      closeList(); closeBlockquote();
      const text = h2Match[1];
      const id = generateId(text);
      html.push(`<div class="mt-14 mb-6" id="${id}"><div class="w-12 h-1 bg-[#F4C430] mb-4 rounded-full"></div><h2 class="text-xl sm:text-2xl font-bold uppercase tracking-wide scroll-mt-24">${parseInline(text)}</h2></div>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      closeList(); closeBlockquote();
      html.push('<div class="my-10 flex items-center gap-4"><div class="flex-1 h-px bg-black/10"></div><span class="w-2 h-2 bg-[#F4C430] rounded-full"></span><div class="flex-1 h-px bg-black/10"></div></div>');
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s*(.*)/);
    if (bqMatch) {
      closeList();
      if (!inBlockquote) {
        html.push('<blockquote class="border-l-4 border-[#F4C430] bg-[#F4C430]/5 pl-5 pr-4 py-4 my-6 rounded-r-lg">');
        inBlockquote = true;
      }
      html.push(`<p class="text-sm italic text-black/60 leading-relaxed">${parseInline(bqMatch[1])}</p>`);
      continue;
    } else {
      closeBlockquote();
    }

    // Unordered list
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      if (inOrderedList) { html.push('</ol>'); inOrderedList = false; }
      if (!inList) {
        html.push('<ul class="my-4 space-y-2">');
        inList = true;
      }
      html.push(`<li class="text-sm text-black/70 leading-relaxed flex items-start gap-3"><span class="w-1.5 h-1.5 bg-[#F4C430] rounded-full mt-2 shrink-0"></span><span>${parseInline(ulMatch[1])}</span></li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (olMatch) {
      if (inList) { html.push('</ul>'); inList = false; }
      if (!inOrderedList) {
        html.push('<ol class="my-4 space-y-2 counter-reset-list">');
        inOrderedList = true;
      }
      html.push(`<li class="text-sm text-black/70 leading-relaxed flex items-start gap-3"><span class="w-6 h-6 bg-black text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">${olMatch[1]}</span><span>${parseInline(olMatch[2])}</span></li>`);
      continue;
    }

    // Image: ![alt](url)
    const imgMatch = line.match(/^!\[(.*)?\]\((.+?)\)/);
    if (imgMatch) {
      closeList();
      const alt = imgMatch[1] || '';
      const src = imgMatch[2];
      html.push(`<figure class="my-8 rounded-lg overflow-hidden border border-black/10"><img src="${src}" alt="${escapeHtml(alt)}" class="w-full" loading="lazy" />${alt ? `<figcaption class="bg-black/[0.02] px-4 py-2 font-mono text-xs text-black/50 text-center">${escapeHtml(alt)}</figcaption>` : ''}</figure>`);
      continue;
    }

    // Paragraph
    closeList();
    html.push(`<p class="text-sm sm:text-base text-black/70 leading-relaxed mb-5">${parseInline(line)}</p>`);
  }

  closeList();
  closeBlockquote();
  closeCallout();
  closeTable();

  return html.join('\n');
}

export default function BlogContent({ content }: BlogContentProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className="blog-content max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Export for use by TableOfContents
export function extractHeadings(content: string): { id: string; text: string; level: 2 | 3 }[] {
  const headings: { id: string; text: string; level: 2 | 3 }[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      headings.push({ id: generateId(h2[1]), text: h2[1], level: 2 });
      continue;
    }
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      headings.push({ id: generateId(h3[1]), text: h3[1], level: 3 });
    }
  }

  return headings;
}
