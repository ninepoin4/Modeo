import { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { GenuiFence } from '../genui/GenuiHost.jsx';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** URL 白名单：仅 http/https 外链与本地 /uploads/ 引用（拒绝 javascript: 等） */
function safeUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/uploads\//.test(url)) return url;
  return null;
}

const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'mov']);

function mediaTag(url) {
  const ext = url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (AUDIO_EXT.has(ext)) {
    return `<audio controls preload="none" class="my-1.5 w-full max-w-md" src="${url}"></audio>`;
  }
  if (VIDEO_EXT.has(ext)) {
    return `<video controls preload="none" class="my-1.5 max-h-80 w-full max-w-lg rounded-xl border border-line" src="${url}"></video>`;
  }
  return null;
}

function inline(text) {
  let t = escapeHtml(text);
  // 图片 ![alt](url)：loading=lazy 懒加载 + max-h 缩略显示 + 点击查看原图（data-lightbox 事件委托）
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const safe = safeUrl(url);
    if (!safe) return m;
    return `<img src="${safe}" alt="${alt || ''}" loading="lazy" data-lightbox="1" class="my-1.5 max-h-96 max-w-full cursor-zoom-in rounded-xl border border-line" />`;
  });
  // 多媒体链接 [name](url) → 按扩展名渲染为 audio/video
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/uploads\/[^\s)]+)\)/g, (m, label, url) => {
    const safe = safeUrl(url);
    if (!safe) return m;
    const media = mediaTag(safe);
    if (media) return media;
    return `<a href="${safe}" target="_blank" rel="noreferrer" class="underline decoration-line underline-offset-4 hover:text-ink-soft">${label}</a>`;
  });
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
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-ink-soft">
        {lang === 'diff'
          ? code.split('\n').map((line, i) => {
              // 2026-08-18 P2-⑨：可视化 diff——+ 新增(绿) / - 删除(红) / @@ 位置(蓝) / 其余默认
              const cls = line.startsWith('+')
                ? 'block bg-emerald-500/10 text-emerald-700'
                : line.startsWith('-')
                  ? 'block bg-rose-500/10 text-rose-600'
                  : line.startsWith('@@')
                    ? 'block bg-sky-500/10 text-sky-700'
                    : 'block';
              return (
                <span key={i} className={cls}>
                  {line || ' '}
                </span>
              );
            })
          : code}
      </pre>
    </div>
  );
}

/** 轻量 Markdown：代码块 / 标题 / 引用 / 列表 / 段落 / 分隔线 + 内联格式 */
export default function Markdown({ content }) {
  const [zoom, setZoom] = useState(null);

  // 事件委托：点图片（data-lightbox）打开原图查看
  const handleClick = (e) => {
    const t = e.target;
    if (t?.tagName === 'IMG' && t.dataset?.lightbox) {
      e.stopPropagation();
      setZoom({ src: t.currentSrc || t.src, alt: t.alt || '' });
    }
  };

  // lightbox 打开时监听 window 键盘（div 不可聚焦，React 合成事件收不到 ESC）
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e) => e.key === 'Escape' && setZoom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const lines = String(content || '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```([\w-]*)\s*$/);
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
    <div className="space-y-1" onClick={handleClick}>
      {blocks.map((b, idx) => {
        // 2026-08-18：GenUI 原生嵌入——模型输出的 ```dsh-ui 围栏渲染为交互组件
        if (b.type === 'code' && b.lang === 'dsh-ui') return <GenuiFence key={idx} raw={b.code} />;
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
      {zoom && (
        <div
          data-testid="lightbox"
          className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/85 p-6"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20"
            onClick={() => setZoom(null)}
            aria-label="关闭原图"
          >
            <X className="h-5 w-5" />
          </button>
          <img src={zoom.src} alt={zoom.alt} className="max-h-[88vh] max-w-full rounded-xl object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}
