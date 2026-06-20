import { useState } from 'react';
import type { ChatConversation, ConversionRecord } from '../../../shared/sidecar';

interface Props {
  chats: ChatConversation[];
  works: ConversionRecord[];
  onSelectChat: (id: string) => void;
  onSelectWork: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onDeleteWork: (id: string) => void;
}

interface HistItem {
  id: string;
  kind: 'chat' | 'work';
  title: string;
  ts: number;
}

function ChatIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
    </svg>
  );
}

function WorkIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  );
}

function relDay(ts: number): string {
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date(ts);
  b.setHours(0, 0, 0, 0);
  const diff = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff < 7) return `${diff}일 전`;
  if (diff < 30) return `${Math.floor(diff / 7)}주 전`;
  return `${Math.floor(diff / 30)}개월 전`;
}

export default function HistoryView({
  chats,
  works,
  onSelectChat,
  onSelectWork,
  onDeleteChat,
  onDeleteWork,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');

  const all: HistItem[] = [
    ...chats.map((c) => ({ id: c.id, kind: 'chat' as const, title: c.title, ts: c.updatedAt })),
    ...works.map((w) => ({ id: w.id, kind: 'work' as const, title: w.title, ts: w.createdAt })),
  ].sort((a, b) => b.ts - a.ts);

  const q = query.trim().toLowerCase();
  const filtered = q ? all.filter((i) => i.title.toLowerCase().includes(q)) : all;

  const groups: { label: string; items: HistItem[] }[] = [];
  for (const it of filtered) {
    const label = relDay(it.ts);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }

  function open(it: HistItem): void {
    if (it.kind === 'chat') onSelectChat(it.id);
    else onSelectWork(it.id);
  }
  function del(it: HistItem): void {
    if (it.kind === 'chat') onDeleteChat(it.id);
    else onDeleteWork(it.id);
  }

  return (
    <div className="history">
      <div className="hist-top">
        <input
          className="hist-search"
          placeholder="기록 검색…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted hist-blank">{all.length === 0 ? '아직 기록이 없습니다.' : '검색 결과가 없습니다.'}</p>
      ) : (
        groups.map((g) => (
          <div className="hist-group" key={g.label}>
            <div className="hist-group-head">
              {g.label} <span className="hist-count">{g.items.length}</span>
            </div>
            {g.items.map((it) => (
              <div className="hist-row" key={`${it.kind}-${it.id}`} onClick={() => open(it)}>
                <span className="hist-ic">{it.kind === 'chat' ? <ChatIcon /> : <WorkIcon />}</span>
                <span className="hist-row-title">{it.title}</span>
                <span className="hist-row-date">
                  {new Date(it.ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                </span>
                <span
                  className="hist-row-del"
                  title="삭제"
                  onClick={(e) => {
                    e.stopPropagation();
                    del(it);
                  }}
                >
                  ✕
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
