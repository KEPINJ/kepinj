import { Fragment } from 'react';

/** Penampil Markdown ringan untuk jawaban asisten: judul, tebal/miring, kode, daftar, dan tabel. Tanpa HTML mentah (aman dari XSS). */
function inline(text, key = 0) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0; let m; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<b key={`${key}-${i++}`}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('`')) parts.push(<code key={`${key}-${i++}`} className="rounded bg-slate-100 px-1 font-mono text-[0.92em]">{t.slice(1, -1)}</code>);
    else parts.push(<i key={`${key}-${i++}`}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const sel = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const angka = (s) => /^[-+]?(Rp\s?)?[\d.,]+%?$/.test(s.replace(/\s/g, ''));

export default function Markdown({ text = '' }) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(<p key={i} className={h[1].length <= 2 ? 'mt-2 text-[15px] font-semibold text-slate-900' : 'mt-1.5 font-semibold text-slate-800'}>{inline(h[2], i)}</p>); i++; continue; }
    if (/^\s*\|/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const head = sel(l); const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(sel(lines[i++]));
      out.push(
        <div key={`t${i}`} className="my-1 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50"><tr>{head.map((c, j) => <th key={j} className="px-2.5 py-1.5 text-left font-semibold text-slate-700">{inline(c, j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, a) => <tr key={a} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className={`px-2.5 py-1.5 ${angka(c) ? 'num text-right' : ''}`}>{inline(c, j)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l); const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      out.push(<Tag key={`l${i}`} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}>{items.map((t, j) => <li key={j}>{inline(t, j)}</li>)}</Tag>);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={`p${i}`}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, j)}</Fragment>)}</p>);
  }
  return <div className="space-y-2 text-sm leading-relaxed text-slate-700">{out}</div>;
}
