import { useState } from 'react';
import { Plus, Upload, Download, Package, Store, RefreshCw, PencilLine, Users, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';

function SectionTitle({ children, right }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <span className="font-serif-display text-[12px] tracking-[0.2em] text-muted">{children}</span>
      {right}
    </div>
  );
}

export default function RoleplaySidebar({
  characters,
  session,
  worldState,
  packs,
  marketPacks,
  onAddToCast,
  onSetActive,
  onRemoveCast,
  onNewCharacter,
  onEditCharacter,
  onImportCharacter,
  onImportPack,
  onExportPack,
  onInstallPack,
  onMarketRefresh,
  onInstallMarket,
  onEditWorldState,
}) {
  const [marketUrl, setMarketUrl] = useState('');
  const nameOf = (id) => characters.find((c) => c.id === id)?.name || id;
  const cast = session?.characters?.length ? session.characters : session?.characterId ? [session.characterId] : [];
  const active = session?.characterId;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-paper2/60">
      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          <div>
            <SectionTitle
              right={
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onNewCharacter} title="新建角色">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onImportCharacter} title="导入角色（CCv3 JSON/PNG）">
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onExportPack} title="导出角色包">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onImportPack} title="从角色包导入">
                    <Package className="h-3.5 w-3.5" />
                  </Button>
                </div>
              }
            >
              角色
            </SectionTitle>
            <div className="space-y-1">
              {characters.map((c) => (
                <button
                  key={c.id}
                  data-testid={`char-${c.id}`}
                  onClick={() => onAddToCast(c.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onEditCharacter(c.id);
                  }}
                  className="group flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-card/60"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-line group-hover:bg-ink" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{c.name}</span>
                    <span className="block truncate text-[11px] text-muted">{c.id}</span>
                  </span>
                </button>
              ))}
              {!characters.length && <p className="px-3 py-2 text-xs text-muted">暂无角色</p>}
            </div>
          </div>

          <div>
            <SectionTitle>角色阵容（本会话）</SectionTitle>
            <div className="space-y-1">
              {cast.map((cid) => (
                <div
                  key={cid}
                  className={cn(
                    'group flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-all',
                    cid === active ? 'border-ink/40 bg-card shadow-paper' : 'border-line bg-card/40'
                  )}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => onSetActive(cid)}>
                    <span className="block truncate text-sm text-ink">{nameOf(cid)}</span>
                    {cid === active && <Badge className="mt-0.5">当前发言</Badge>}
                  </button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemoveCast(cid)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {!cast.length && <p className="px-3 py-2 text-xs text-muted">点击上方角色加入阵容</p>}
            </div>
          </div>

          <div>
            <SectionTitle
              right={
                <Button size="icon" variant="ghost" data-testid="world-state-edit" className="h-7 w-7" onClick={onEditWorldState}>
                  <PencilLine className="h-3.5 w-3.5" />
                </Button>
              }
            >
              世界状态
            </SectionTitle>
            <div className="rounded-xl border border-line bg-card/40 p-3">
              {Object.keys(worldState || {}).length ? (
                <div className="space-y-1">
                  {Object.entries(worldState).map(([k, v]) => (
                    <p key={k} className="text-xs text-ink-soft">
                      <span className="text-muted">{k}：</span>
                      {v}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">暂无剧情事实记录</p>
              )}
            </div>
          </div>

          <div>
            <SectionTitle>本地角色包</SectionTitle>
            <div className="space-y-1">
              {packs.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card/40 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{p.name}</span>
                    <span className="text-[11px] text-muted">{p.characterCount} 个角色</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onInstallPack(p.id)}>
                    安装
                  </Button>
                </div>
              ))}
              {!packs.length && <p className="px-3 py-1 text-xs text-muted">（暂无）</p>}
            </div>
          </div>

          <div>
            <SectionTitle right={<Store className="h-3.5 w-3.5 text-muted" />}>角色市场</SectionTitle>
            <div className="flex gap-1.5">
              <Input
                value={marketUrl}
                onChange={(e) => setMarketUrl(e.target.value)}
                placeholder="市场索引 URL"
                className="h-8 text-xs"
              />
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onMarketRefresh(marketUrl)}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {marketPacks.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card/40 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted">{p.description || p.author}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onInstallMarket(p)}>
                    安装
                  </Button>
                </div>
              ))}
              {!marketPacks.length && <p className="px-3 py-1 text-xs text-muted">（输入索引 URL 后刷新）</p>}
            </div>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
