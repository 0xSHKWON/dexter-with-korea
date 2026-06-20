import { useEffect, useState } from 'react';
import SettingsView from './components/SettingsView';
import HelpView from './components/HelpView';
import ChatView from './components/ChatView';
import WorkView from './components/WorkView';
import HistoryView from './components/HistoryView';
import UpdateGate from './components/UpdateGate';
import SidebarStatus, { type SideStatus } from './components/SidebarStatus';
import type { ChatConversation, ConversionRecord } from '../../shared/sidecar';
import type { UpdateInfo } from '../../shared/types';

type View = 'chat' | 'work' | 'history' | 'settings' | 'help';

const SEARCH_ENVS = [
  'EXASEARCH_API_KEY',
  'PERPLEXITY_API_KEY',
  'TAVILY_API_KEY',
  'LANGSEARCH_API_KEY',
];

function HelpIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 1.9" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GearIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PanelIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
    </svg>
  );
}

function ClockIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5l3.2 1.8" />
    </svg>
  );
}

function ChatGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
    </svg>
  );
}

function WorkGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  );
}

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('chat');
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<SideStatus | null>(null);

  const [chats, setChats] = useState<ChatConversation[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatSeed, setChatSeed] = useState<string | null>(null);
  const [works, setWorks] = useState<ConversionRecord[]>([]);
  const [workId, setWorkId] = useState<string | null>(null);

  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  async function loadStatus(): Promise<void> {
    try {
      const [provs, setts, secs] = await Promise.all([
        window.dexter.providers.list(),
        window.dexter.settings.getAll(),
        window.dexter.secrets.statusAll(),
      ]);
      const sec: Record<string, boolean> = {};
      for (const s of secs) sec[s.envVar] = s.exists;
      const llm = provs.some((p) => p.apiKeyEnvVar && sec[p.apiKeyEnvVar]);
      setStatus({
        modelId: setts.modelId,
        llm,
        items: [
          { label: 'DART', connected: !!sec['DART_API_KEY'] },
          { label: 'KRX', connected: !!sec['KRX_ID'] && !!sec['KRX_PW'] },
          { label: '국민연금', connected: !!sec['DATA_GO_KR_SERVICE_KEY'] },
          { label: '웹 검색', connected: SEARCH_ENVS.some((e) => sec[e]) },
        ],
      });
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadStatus();
    void window.dexter.chat.listConversations().then(setChats).catch(() => {});
    void window.dexter.work.list().then(setWorks).catch(() => {});
    void window.dexter.update.check().then(setUpdate).catch(() => {});
  }, []);

  // Help example → start a fresh chat with the prompt prefilled in the composer.
  function usePrompt(text: string): void {
    setChatId(null);
    void window.dexter.chat.reset();
    setChatSeed(text);
    setView('chat');
  }

  function newChat(): void {
    setView('chat');
    setChatId(null);
    void window.dexter.chat.reset();
  }
  function selectChat(id: string): void {
    setView('chat');
    setChatId(id);
    void window.dexter.chat.reset();
  }
  function onChatSaved(conv: ChatConversation): void {
    setChats((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
    setChatId(conv.id);
  }

  function newWork(): void {
    setView('work');
    setWorkId(null);
  }
  function selectWork(id: string): void {
    setView('work');
    setWorkId(id);
  }
  function onWorkSaved(rec: ConversionRecord): void {
    setWorks((prev) => [rec, ...prev.filter((w) => w.id !== rec.id)]);
    setWorkId(rec.id);
  }

  function onDeleteChat(id: string): void {
    void window.dexter.chat.deleteConversation(id);
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (chatId === id) setChatId(null);
  }
  function onDeleteWork(id: string): void {
    void window.dexter.work.delete(id);
    setWorks((prev) => prev.filter((w) => w.id !== id));
    if (workId === id) setWorkId(null);
  }

  const currentChat = chats.find((c) => c.id === chatId) ?? null;
  const currentWork = works.find((w) => w.id === workId) ?? null;

  // Required update: lock the whole app behind the update screen.
  if (update?.status === 'required') {
    return <UpdateGate info={update} />;
  }

  const showUpdateBanner = update?.status === 'optional' && !updateDismissed;

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="side-top">
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(true)}
            title="사이드바 접기"
            aria-label="사이드바 접기"
          >
            <PanelIcon />
          </button>
        </div>

        <button
          className={`hist-head ${view === 'history' ? 'active' : ''}`}
          onClick={() => setView('history')}
        >
          <ClockIcon />
          <span>History</span>
        </button>

        <nav className="side-nav">
          <div className={`nav-row ${view === 'chat' ? 'active' : ''}`}>
            <button className="nav-item" onClick={() => setView('chat')}>
              <ChatGlyph />
              <span>Chat</span>
            </button>
            <button className="nav-add" onClick={newChat} title="New chat" aria-label="New chat">
              +
            </button>
          </div>
          <div className={`nav-row ${view === 'work' ? 'active' : ''}`}>
            <button className="nav-item" onClick={() => setView('work')}>
              <WorkGlyph />
              <span>Work</span>
            </button>
            <button className="nav-add" onClick={newWork} title="New conversion" aria-label="New conversion">
              +
            </button>
          </div>
        </nav>

        <div className="sidebar-spacer" />

        <SidebarStatus status={status} />

        <div className="sidebar-actions">
          <span className="version">v0.0.1</span>
          <div className="action-icons">
            <button
              className={`icon-btn ${view === 'help' ? 'active' : ''}`}
              onClick={() => setView('help')}
              title="도움말"
              aria-label="도움말"
            >
              <HelpIcon />
            </button>
            <button
              className={`icon-btn ${view === 'settings' ? 'active' : ''}`}
              onClick={() => setView('settings')}
              title="설정"
              aria-label="설정"
            >
              <GearIcon />
            </button>
          </div>
        </div>
      </aside>

      <main className="content">
        {collapsed && (
          <button
            className="expand-btn"
            onClick={() => setCollapsed(false)}
            title="사이드바 펼치기"
            aria-label="사이드바 펼치기"
          >
            <PanelIcon />
          </button>
        )}
        {showUpdateBanner && update && (
          <div className="update-banner">
            <span>
              새 버전 v{update.latest}이 있습니다.
            </span>
            <div className="update-banner-actions">
              <button className="btn primary sm" onClick={() => void window.dexter.update.open(update.url)}>
                업데이트
              </button>
              <button className="btn ghost sm" onClick={() => setUpdateDismissed(true)}>
                나중에
              </button>
            </div>
          </div>
        )}
        <div className={`view ${view === 'chat' ? '' : 'hidden'}`}>
          <ChatView
            conversation={currentChat}
            onSaved={onChatSaved}
            onOpenSettings={() => setView('settings')}
            seed={chatSeed}
            onSeedConsumed={() => setChatSeed(null)}
          />
        </div>
        <div className={`view ${view === 'work' ? '' : 'hidden'}`}>
          <WorkView conversion={currentWork} onSaved={onWorkSaved} />
        </div>
        <div className={`view ${view === 'history' ? '' : 'hidden'}`}>
          <HistoryView
            chats={chats}
            works={works}
            onSelectChat={selectChat}
            onSelectWork={selectWork}
            onDeleteChat={onDeleteChat}
            onDeleteWork={onDeleteWork}
          />
        </div>
        <div className={`view ${view === 'settings' ? '' : 'hidden'}`}>
          <SettingsView onKeysChanged={loadStatus} />
        </div>
        <div className={`view ${view === 'help' ? '' : 'hidden'}`}>
          <HelpView onUsePrompt={usePrompt} />
        </div>
      </main>
    </div>
  );
}
