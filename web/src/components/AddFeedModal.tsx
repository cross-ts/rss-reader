import { useState } from 'react';
import { api, type Folder, type FeedCandidate } from '../api/client';
import { useSubscriptionMutations } from '../hooks/useSubscriptionMutations';
import { Footer, Modal, btnCls, btnPri, inputCls } from './Modal';
import { useToast } from './Toast';

export function AddFeedModal({ folders, onClose }: { folders: Folder[]; onClose: () => void }) {
  const toast = useToast();
  const { createFeed } = useSubscriptionMutations();
  const [url, setUrl] = useState('');
  const [cands, setCands] = useState<FeedCandidate[] | null>(null);
  const [chosen, setChosen] = useState<FeedCandidate | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);

  const discover = async () => {
    const v = url.trim();
    if (!v || busy) return;
    setBusy(true);
    setChosen(null);
    try {
      setCands(await api.discoverFeed(v.includes('://') ? v : 'https://' + v));
    } catch {
      setCands([]);
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    chosen &&
    createFeed.mutate(
      { url: chosen.feedUrl, folder: folder || null },
      {
        onSuccess: () => {
          onClose();
          toast('フィードを追加しました');
        },
      },
    );

  return (
    <Modal title="フィードを追加" onClose={onClose}>
      <label className="mb-1.5 block text-[13px] text-muted">URL</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && discover()}
          placeholder="https://example.com または フィード URL"
          className={inputCls}
        />
        <button type="button" className={`${btnCls} flex-none`} onClick={discover} disabled={busy}>
          探す
        </button>
      </div>
      {cands && cands.length === 0 && <div className="py-3.5 text-sm text-muted">フィードが見つかりませんでした</div>}
      {cands && cands.length > 0 && (
        <>
          <label className="mt-3.5 mb-1.5 block text-[13px] text-muted">検出されたフィード</label>
          {cands.map((c) => (
            <button
              key={c.feedUrl}
              type="button"
              onClick={() => setChosen(c)}
              className={`mt-2 block w-full min-w-0 rounded-[10px] border px-3 py-2.5 text-left text-sm [overflow-wrap:anywhere] ${chosen === c ? 'border-accent' : 'border-line'}`}
            >
              {c.title ?? c.feedUrl}
              <small className="block text-muted">
                {c.feedUrl}
                {c.type ? ` · ${c.type}` : ''}
              </small>
            </button>
          ))}
        </>
      )}
      <label className="mt-3.5 mb-1.5 block text-[13px] text-muted" htmlFor="add-feed-folder">
        フォルダ
      </label>
      <select id="add-feed-folder" value={folder} onChange={(e) => setFolder(e.target.value)} className={inputCls}>
        <option value="">未分類</option>
        {[...folders]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => (
            <option key={f.id} value={f.name}>
              {'　'.repeat(f.name.split('/').length - 1)}
              {f.name}
            </option>
          ))}
      </select>
      <Footer>
        <button type="button" className={btnCls} onClick={onClose}>
          キャンセル
        </button>
        <button type="button" className={btnPri} onClick={add} disabled={!chosen || createFeed.isPending}>
          追加
        </button>
      </Footer>
    </Modal>
  );
}
