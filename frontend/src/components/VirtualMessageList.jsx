/**
 * 虚拟消息列表（手写窗口化渲染，零依赖）。
 * 解决：长会话（数百条消息）时 DOM 节点累积 + 全量渲染导致卡顿。
 * 方案：ResizeObserver 测量每条消息实际高度 → 二分查找可视区 → 只渲染视口 + overscan，
 *       paddingTop/paddingBottom 占位保持滚动条总高度正确。
 * 对应社群共识：Claude Code #31666（DOM 累积→renderer 内存爆炸）与 #10881（全量重渲染）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const ESTIMATE = 64; // 未测量时的估算高度（px）
const GAP = 16; // 消息间距（与原 space-y-4 一致）
const OVERSCAN = 6; // 视口外预渲染条数，减少滚动闪烁
const EDGE_PAD = 24; // 顶部/底部留白（原 py-6）

export default function VirtualMessageList({ items, getKey, children, scrollRef, onNearBottom, className = '' }) {
  const containerRef = scrollRef || useRef(null);
  const [heights, setHeights] = useState(() => new Map());
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const [range, setRange] = useState({ start: 0, end: 20 });
  const obsRef = useRef(null);
  const nearBottomRef = useRef(true);

  /** 每条消息偏移量（含间距）；heights 变化时重算 */
  const offsets = useMemo(() => {
    const offs = [0];
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      acc += (heightsRef.current.get(getKey(items[i])) || ESTIMATE) + GAP;
      offs.push(acc);
    }
    return offs;
  }, [items, heights, getKey]);
  const total = offsets.length ? offsets[offsets.length - 1] - GAP : 0;

  /** 注册条目测量（单个 ResizeObserver 观察所有已渲染项） */
  const register = useCallback((el, key) => {
    if (!el) return;
    el.dataset.vkey = key;
    if (!obsRef.current) {
      obsRef.current = new ResizeObserver((entries) => {
        let changed = false;
        const next = new Map(heightsRef.current);
        for (const en of entries) {
          const k = en.target.dataset.vkey;
          const h = en.contentRect.height;
          if (k && next.get(k) !== h) {
            next.set(k, h);
            changed = true;
          }
        }
        if (changed) {
          heightsRef.current = next;
          setHeights(next);
        }
      });
    }
    obsRef.current.observe(el);
  }, []);

  useEffect(() => () => obsRef.current?.disconnect(), []);

  /** 滚动 → 二分查找可视范围 + 上报"是否靠近底部" */
  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const viewH = el.clientHeight;
    // 第一个 offset > top 的索引（lower bound）
    let lo = 0;
    let hi = offsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] <= top) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - 1 - OVERSCAN);
    let end = start;
    const limit = top + viewH;
    while (end < offsets.length - 1 && offsets[end + 1] <= limit) end++;
    end = Math.min(items.length, end + 1 + OVERSCAN);
    setRange({ start, end });
    const dist = total - top - viewH;
    nearBottomRef.current = dist < 120;
    onNearBottom?.(dist);
  }, [offsets, items.length, total, onNearBottom, containerRef]);

  // 初始定位到底部（历史会话从底部看起）
  useEffect(() => {
    const el = containerRef.current;
    if (el && items.length) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新消息到达：若用户正贴底，则扩展 range 使新消息进入渲染（否则等滚动触发）
  useEffect(() => {
    if (nearBottomRef.current) {
      setRange((r) => ({ start: Math.max(0, r.start), end: items.length }));
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [items.length, containerRef]);

  const visible = items.slice(range.start, range.end);
  const padTop = EDGE_PAD + (offsets[range.start] || 0);
  const padBottom = EDGE_PAD + Math.max(0, total - (offsets[range.end] || 0));

  return (
    <div
      ref={containerRef}
      data-testid="messages"
      onScroll={onScroll}
      className={`overflow-y-auto ${className}`}
    >
      <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
        {visible.map((it, i) => {
          const abs = range.start + i;
          return (
            <div
              key={getKey(it)}
              ref={(el) => register(el, getKey(it))}
              style={{ marginBottom: GAP }}
            >
              {children(it, abs)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
