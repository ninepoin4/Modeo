import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/utils';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(text) {
  let t = escapeHtml(text);
  // [text](url) -> 链接（仅 http/https）
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="underline decoration-line underline-offset-4 hover:text-ink-soft">$1</a>');
  // `code`
  t = t.replace(/`([^`]+)`/g, '<code class="rounded bg-paper2 px-1.5 py-0.5 font-mono text-[0.85em]">$1</code>');
  // **bold**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold">$1</strong>');
  // *italic*
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return t;
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="group relative my-2 overflow-hidden rounded-xl border border-line bg-paper2/70">
      <div className="flex items-center justify-between border-b border-line/70 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted">{lang || 'code'}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-card hover:text-ink"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-ink-soft">{code}</pre>
    </div>
  );
}

/** 轻量 Markdown：代码块 / 标题 / 引用 / 列表 / 段落 / 分隔线 + 内联格式 */
export default function Markdown({ content }) {
  const lines = String(content || '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      blocks.push({ type: 'code', lang, code: buf.join('\n') });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#{1,6})\s/)[1].length;
      blocks.push({ type: `h${level}`, html: inline(line.replace(/^#{1,6}\s/, '')) });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', html: inline(buf.join('\n')) });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')));
        i++;
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }
    if (/^\s*---+$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', html: inline(buf.join('\n')) });
  }

  const headClass = {
    h1: 'mt-3 mb-1.5 font-serif-display text-xl',
    h2: 'mt-3 mb-1.5 font-serif-display text-lg',
    h3: 'mt-2.5 mb-1 font-serif-display text-base',
  };

  return (
    <div className="space-y-1">
      {blocks.map((b, idx) => {
        if (b.type === 'code') return <CodeBlock key={idx} code={b.code} lang={b.lang} />;
        if (b.type === 'quote')
          return (
            <blockquote key={idx} className="border-l-2 border-line pl-3 text-ink-soft" dangerouslySetInnerHTML={{ __html: b.html }} />
          );
        if (b.type === 'ul' || b.type === 'ol')
          return (
            <ul key={idx} className={cn('my-1 list-disc space-y-0.5 pl-5', b.type === 'ol' && 'list-decimal')}>
              {b.items.map((it, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: it }} />
              ))}
            </ul>
          );
        if (b.type === 'hr') return <hr key={idx} className="my-3 border-line" />;
        if (b.type.startsWith('h'))
          return <div key={idx} className={headClass[b.type]} dangerouslySetInnerHTML={{ __html: b.html }} />;
        return <p key={idx} className="min-h-[1.4em]" dangerouslySetInnerHTML={{ __html: b.html }} />;
      })}
    </div>
  );
}
