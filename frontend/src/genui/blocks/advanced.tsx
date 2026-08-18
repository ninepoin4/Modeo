/**
 * Advanced family: callout/steps/keyvalue, plot/diff/json/code, tabs and
 * accordion containers (recursing through renderNode), copy, mermaid,
 * scene3d, timeline, file-tree, quiz, breadcrumb.
 * @module @omdsh-dev/dsh-genui/client/blocks/advanced
 */
import { useEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import css from '../GenuiBlock.module.css'
import { GENUI_LIMITS } from '../guard.ts'
import { PlotBlock } from '../PlotBlock.tsx'
import { renderNode } from './render-node.tsx'
import type { AnswersState, GenuiBlockProps } from './state.ts'
import type {
  GenuiAccordion, GenuiBreadcrumb, GenuiCallout, GenuiCode, GenuiCopy, GenuiDiff, GenuiFileTree, GenuiFileTreeNode,
  GenuiJson, GenuiKeyValue, GenuiMermaid, GenuiPlot, GenuiQuiz, GenuiScene3D, GenuiSteps, GenuiTabs, GenuiTimeline,
} from '../spec.ts'

const CALLOUT_TONES: Record<string, string> = {
  info: css.calloutInfo!, success: css.calloutSuccess!, warning: css.calloutWarning!, error: css.calloutError!,
}

/** Callout: a tinted notice box with an optional heading. */
export function CalloutNode({ node }: { node: GenuiCallout }) {
  const tone = node.tone ?? 'info'
  const toneClass = CALLOUT_TONES[tone] ?? css.calloutInfo
  return (
    <div className={`${css.callout} ${toneClass}`} data-genui-callout>
      {node.title !== undefined && <div className={css.calloutTitle}>{node.title}</div>}
      <div className={css.calloutBody}>{node.content}</div>
    </div>
  )
}

/** Steps: a vertical progress checklist with an optional current index. */
export function StepsNode({ steps }: { steps: GenuiSteps }) {
  const list = steps.steps.slice(0, GENUI_LIMITS.maxSteps)
  const current = steps.current ?? list.length
  return (
    <ol className={css.steps}>
      {list.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={i} className={`${css.step} ${done ? css.stepDone : ''} ${active ? css.stepActive : ''}`}>
            <span className={css.stepMarker}>{done ? '✓' : String(i + 1)}</span>
            <span className={css.stepContent}>
              <span className={css.stepTitle}>{step.title}</span>
              {step.desc !== undefined && <span className={css.stepDesc}>{step.desc}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** KeyValue: a definition list for configs and metadata. */
export function KeyValueNode({ node }: { node: GenuiKeyValue }) {
  const pairs = node.pairs.slice(0, GENUI_LIMITS.maxKeyValuePairs)
  return (
    <dl className={css.keyvalue}>
      {pairs.map((pair, i) => (
        <div key={i} className={css.kvRow}>
          <dt className={css.kvKey}>{pair.key}</dt>
          <dd className={css.kvValue}>{pair.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Plot: SVG function plot over the SafeMath evaluator. */
export function PlotNode({ plot }: { plot: GenuiPlot }) {
  const series = plot.series.slice(0, GENUI_LIMITS.maxPlotSeries)
  return (
    <PlotBlock
      series={series.map(s => ({ expr: s.expr, label: s.label, color: s.color, kind: s.kind, params: s.params }))}
      xMin={plot.xMin} xMax={plot.xMax} yMin={plot.yMin} yMax={plot.yMax} title={plot.title}
    />
  )
}

const MONO_STYLE: React.CSSProperties = {
  fontFamily: 'var(--dsl-g-font-mono, ui-monospace, monospace)',
  fontSize: 12,
  lineHeight: 1.6,
  margin: 0,
  padding: '8px 10px',
  background: 'var(--dsl-g-surface-2, rgba(127,127,127,0.08))',
  borderRadius: 6,
  overflowX: 'auto',
  whiteSpace: 'pre',
}

/** Diff: Modeo 原生简化渲染（原 dsh DiffBlock 替代）——同 path 的 old/new 双栏对比。 */
export function DiffNode({ node }: { node: GenuiDiff }) {
  return (
    <div data-genui-diff>
      {node.diffs.map((d, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 500, margin: '4px 0' }}>{d.path}</div>
          {d.oldText !== null && d.oldText !== undefined && (
            <pre style={{ ...MONO_STYLE, color: '#b91c1c', marginBottom: 4 }}>{d.oldText}</pre>
          )}
          {d.newText !== null && d.newText !== undefined && (
            <pre style={{ ...MONO_STYLE, color: '#15803d' }}>{d.newText}</pre>
          )}
        </div>
      ))}
    </div>
  )
}

function JsonTreeView({ data }: { data: unknown }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (typeof data !== 'object' || data === null) {
    return <span style={{ color: 'var(--dsw-alias-label-secondary, #666)' }}>{String(data)}</span>
  }
  const isArr = Array.isArray(data)
  const entries = isArr ? (data as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(data as Record<string, unknown>)
  return (
    <div style={{ fontFamily: 'var(--dsl-g-font-mono, ui-monospace, monospace)', fontSize: 12 }}>
      {entries.map(([k, v]) => {
        const childOpen = open[k] ?? false
        const isObj = typeof v === 'object' && v !== null
        return (
          <div key={k} style={{ marginLeft: 12 }}>
            <span
              onClick={() => isObj && setOpen((o) => ({ ...o, [k]: !o[k] }))}
              style={{ cursor: isObj ? 'pointer' : 'default', color: '#185FA5', marginRight: 4 }}
            >
              {isObj ? (childOpen ? '▾' : '▸') : ''}
            </span>
            <span style={{ color: '#854F0B' }}>{k}</span>
            <span style={{ color: '#888' }}>: </span>
            {isObj ? (
              <span style={{ color: '#888' }}>{childOpen ? '' : isArr ? `Array(${(v as unknown[]).length})` : '{…}'}</span>
            ) : (
              <span style={{ color: '#15803d' }}>{JSON.stringify(v)}</span>
            )}
            {childOpen && <JsonTreeView data={v} />}
          </div>
        )
      })}
    </div>
  )
}

/** Json: Modeo 原生 JSON 树查看器（原 dsh JsonTree 替代）。 */
export function JsonNode({ node }: { node: GenuiJson }) {
  const data = node.value
  if (typeof data !== 'object' || data === null) {
    return <div className={css.jsonScalar}>{String(data)}</div>
  }
  return <JsonTreeView data={data} />
}

/** Code: Modeo 原生代码块（原 dsh CodeBlock 替代）。 */
export function CodeNode({ node }: { node: GenuiCode }) {
  const code = node.code.slice(0, GENUI_LIMITS.maxCode)
  return (
    <div data-genui-code>
      {node.lang !== undefined && node.lang !== '' && (
        <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)', margin: '2px 0' }}>{node.lang}</div>
      )}
      <pre style={MONO_STYLE}>{code}</pre>
    </div>
  )
}

/**
 * Table: LOCAL sorting (v2.9) — click a header to sort ascending, click
 * again for descending, a third click restores the spec order. Zero model
 * round trip. Numeric cells (numbers or numeric strings) compare numerically;
 * everything else compares as text.
 */
export function TabsNode({ tabs, onAction, depth = 0, answers }: {
  tabs: GenuiTabs
  onAction?: GenuiBlockProps['onAction']
  depth?: number
  answers?: AnswersState | undefined
}) {
  const [active, setActive] = useState(0)
  const uid = useId()
  const list = tabs.tabs.slice(0, GENUI_LIMITS.maxTabs)
  const current = list[active]
  const move = (next: number): void => {
    const n = (next + list.length) % list.length
    setActive(n)
    document.getElementById(`${uid}-tab-${n}`)?.focus()
  }
  return (
    <div className={css.tabs}>
      <div
        className={css.tabBar}
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={e => {
          if (e.key === 'ArrowRight') { e.preventDefault(); move(active + 1) }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); move(active - 1) }
          else if (e.key === 'Home') { e.preventDefault(); move(0) }
          else if (e.key === 'End') { e.preventDefault(); move(list.length - 1) }
        }}
      >
        {list.map((tab, i) => (
          <button
            key={i}
            id={`${uid}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`${uid}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            className={`${css.tab} ${i === active ? css.tabActive : ''}`}
            onClick={() => setActive(i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current !== undefined && (
        <div className={css.col} role="tabpanel" id={`${uid}-panel-${active}`} aria-labelledby={`${uid}-tab-${active}`}>
          {current.items.map((c, i) => renderNode(c, i, onAction, depth + 1, answers))}
        </div>
      )}
    </div>
  )
}

/** Radio: one option from a group; local selection state. The group name is
 * useId-based so sibling groups never collide (deterministic per mount).
 *
 * v2.5 aggregation: when `group` is set, the selection is recorded into the
 * block-wide answers registry instead of firing a per-click action — a
 * sibling `submit` node then grades the paper IN PLACE (v2.6, questions
 * carry `answer` data) or collects all groups in ONE action. Without
 * `group`, the legacy per-click action fires. After a local grading the
 * group locks until 重新作答 resets it. */
export function AccordionNode({ node, onAction, depth = 0, answers }: {
  node: GenuiAccordion
  onAction?: GenuiBlockProps['onAction']
  depth?: number
  answers?: AnswersState | undefined
}) {
  const [open, setOpen] = useState<number | null>(0)
  const uid = useId()
  const items = node.items.slice(0, GENUI_LIMITS.maxAccordionItems)
  return (
    <div className={css.accordion}>
      {items.map((item, i) => (
        <div key={i} className={css.accItem}>
          <button
            type="button"
            className={css.accHead}
            id={`${uid}-head-${i}`}
            aria-expanded={open === i}
            aria-controls={`${uid}-body-${i}`}
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className={css.accTitle}>{item.title}</span>
            <span className={css.accChevron}>{open === i ? '▾' : '▸'}</span>
          </button>
          {open === i && (
            <div className={css.accBody} id={`${uid}-body-${i}`} aria-labelledby={`${uid}-head-${i}`}>
              {item.items.map((c, ci) => renderNode(c, ci, onAction, depth + 1, answers))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Copy: a one-click copy chip. */
export function CopyNode({ node }: { node: GenuiCopy }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`${css.copyChip} ${copied ? css.copyChipDone : ''}`}
      onClick={() => {
        void navigator.clipboard?.writeText(node.text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? '✓ 已复制' : (node.label ?? '复制')}
    </button>
  )
}

/** Mermaid: lazily loaded diagram renderer. */
export function MermaidNode({ node }: { node: GenuiMermaid }) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const code = node.code.slice(0, GENUI_LIMITS.maxMermaid)
  useEffect(() => {
    let alive = true
    void import('../mermaid-lazy.ts').then(async m => {
      try {
        const svg = await m.renderMermaid(code)
        if (alive) setHtml(svg)
      } catch {
        if (alive) setFailed(true)
      }
    })
    return () => { alive = false }
  }, [code])
  if (failed) return <div className={css.mermaidFallback}><pre>{code}</pre><div className={css.mermaidErr}>图语法有误，已降级显示源码</div></div>
  if (html === null) return <div className={css.mermaidFallback}><pre>{code}</pre><div className={css.mermaidHint}>渲染中…</div></div>
  return <div className={css.mermaid} dangerouslySetInnerHTML={{ __html: html }} data-genui-mermaid />
}

/** Scene3D: three.js WebGL canvas, lazily imported. */
export function Scene3DNode({ node }: { node: GenuiScene3D }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const ref = useRef<HTMLDivElement | null>(null)
  // Mesh cap mirrored from the guard: a pathological scene never reaches
  // three.js (per-frame cost scales with mesh count).
  const scene = node.meshes.length > GENUI_LIMITS.maxMeshes ? { ...node, meshes: node.meshes.slice(0, GENUI_LIMITS.maxMeshes) } : node
  useEffect(() => {
    let alive = true
    let dispose: (() => void) | undefined
    void import('../scene3d-lazy.ts').then(async m => {
      if (!alive || ref.current === null) return
      try {
        dispose = await m.mountScene(ref.current, scene)
        if (alive) setStatus('ready')
      } catch {
        if (alive) setStatus('error')
      }
    })
    return () => { alive = false; dispose?.() }
  }, [scene])
  return (
    <div className={css.scene3dWrap} data-genui-scene3d>
      {node.title !== undefined && <div className={css.scene3dTitle}>{node.title}</div>}
      <div ref={ref} className={css.scene3dCanvas} />
      {status === 'loading' && <div className={css.scene3dHint}>加载 3D 场景…</div>}
      {status === 'error' && <div className={css.scene3dHint}>3D 渲染失败</div>}
    </div>
  )
}

/** Timeline: vertical event list with time markers. */
export function TimelineNode({ node }: { node: GenuiTimeline }) {
  const items = node.items.slice(0, GENUI_LIMITS.maxTimelineItems)
  return (
    <div className={css.timeline}>
      {items.map((item, i) => (
        <div key={i} className={css.tlItem}>
          <div className={css.tlRail}>
            <span className={css.tlDot} />
            {i < items.length - 1 && <span className={css.tlLine} />}
          </div>
          <div className={css.tlBody}>
            <div className={css.tlHead}>
              <span className={css.tlTitle}>{item.title}</span>
              {item.time !== undefined && <span className={css.tlTime}>{item.time}</span>}
            </div>
            {item.desc !== undefined && <div className={css.tlDesc}>{item.desc}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** FileTree: indented tree of files and folders. Directory rows are LOCAL
 * collapsible (spec.ts promised "collapsible children"; this makes it true)
 * — click a dir to fold/unfold, default fully open. Zero model round trip. */
export function FileTreeNode({ node }: { node: GenuiFileTree }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const pathKey = (depth: number, i: number): string => `${depth}-${i}`
  const toggle = (k: string): void => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }
  const renderNode = (n: GenuiFileTreeNode, depth: number, i: number): ReactNode => {
    if (depth > GENUI_LIMITS.maxTreeDepth) return null
    const isDir = n.type === 'dir' || (n.children !== undefined && n.children.length > 0)
    const k = pathKey(depth, i)
    const folded = isDir && collapsed.has(k)
    return (
      <div key={k} className={css.ftRow} style={{ paddingLeft: `${depth * 16}px` }}>
        <button
          type="button"
          className={css.ftNameBtn}
          aria-expanded={isDir ? !folded : undefined}
          onClick={isDir ? () => toggle(k) : undefined}
        >
          <span className={`${css.ftIcon} ${isDir ? css.ftIconDir : ''}`} aria-hidden>{isDir ? (folded ? '▸' : '▾') : '·'}</span>
          <span className={`${css.ftName} ${isDir ? css.ftDir : ''}`}>{n.name}</span>
        </button>
        {isDir && !folded && (n.children ?? []).map((c, ci) => renderNode(c, depth + 1, ci))}
      </div>
    )
  }
  return <div className={css.fileTree}>{node.items.slice(0, GENUI_LIMITS.maxListItems).map((n, i) => renderNode(n, 0, i))}</div>
}

/** Quiz: a self-contained teaching question. Selecting an option marks it
 * correct/incorrect in place and reveals feedback + explanation. With
 * `action`, the chosen answer is ALSO sent back to the model
 * (`{type:'quiz', question, answer, correct}`) so the model can collect or
 * grade it — the in-place judging stays local (no round trip needed). */
export function QuizNode({ node, onAction }: {
  node: GenuiQuiz
  onAction?: GenuiBlockProps['onAction']
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const options = node.options.slice(0, GENUI_LIMITS.maxQuizOptions)
  const answered = selected !== null
  const chosen = selected === null ? undefined : options[selected]
  const correct = chosen?.correct === true
  const action = node.action
  return (
    <div className={css.quiz} data-genui-quiz>
      <div className={css.quizQuestion}>{node.question}</div>
      <div className={css.quizOptions}>
        {options.map((opt, i) => {
          const isChosen = selected === i
          const cls = answered
            ? isChosen
              ? opt.correct === true ? css.quizOptCorrect : css.quizOptWrong
              : opt.correct === true ? css.quizOptReveal : css.quizOpt
            : css.quizOpt
          return (
            <button
              key={i}
              type="button"
              className={cls}
              disabled={answered}
              onClick={() => {
                setSelected(i)
                if (action !== undefined && onAction !== undefined) {
                  onAction(action, {
                    type: 'quiz',
                    question: node.question,
                    answer: opt.label,
                    correct: opt.correct === true,
                  })
                }
              }}
            >
              <span className={css.quizMarker}>{answered && (opt.correct === true ? '✓' : isChosen ? '✗' : '')}</span>
              {opt.label}
            </button>
          )
        })}
      </div>
      {answered && (
        <div className={css.quizResult} aria-live="polite">
          <div className={correct ? css.quizCorrectMsg : css.quizWrongMsg}>
            {correct ? '✓ 回答正确！' : '✗ 再想想看'}
            {chosen?.feedback !== undefined && <div className={css.quizFeedback}>{chosen.feedback}</div>}
          </div>
          {node.explanation !== undefined && <div className={css.quizExplanation}>{node.explanation}</div>}
          <button type="button" className={css.quizRetry} onClick={() => setSelected(null)}>重新作答</button>
        </div>
      )}
    </div>
  )
}

/** Breadcrumb: path-style navigation trail. */
export function BreadcrumbNode({ node }: { node: GenuiBreadcrumb }) {
  const items = node.items.slice(0, GENUI_LIMITS.maxBreadcrumbItems)
  return (
    <nav className={css.breadcrumb} aria-label="breadcrumb">
      {items.map((item, i) => (
        <span key={i} className={css.bcItem}>
          <span className={`${css.bcText} ${i === items.length - 1 ? css.bcCurrent : ''}`}>{item}</span>
          {i < items.length - 1 && <span className={css.bcSep}>/</span>}
        </span>
      ))}
    </nav>
  )
}

/**
 * Trailing debounce window (ms) for one `[genui-action]` name: rapid
 * repeated interactions on one control (button mashing, switch flipping)
 * collapse into a single action with the LAST payload. Different action
 * names stay independent. The model round-trip takes seconds, so a few
 * hundred ms of trailing delay is imperceptible — and it stops bursts of
 * queued user turns.
 */
