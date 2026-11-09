import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { List, ListItem } from '@astryxdesign/core/List';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { api, type Folder, type FeedCandidate } from '../api/client';
import { useSubscriptionMutations } from '../hooks/useSubscriptionMutations';
import { FormDialog } from './Dialogs';
import { useToast } from './Toast';
import { folderOptions } from './folderOptions';

export function AddFeedDialog({ folders, onClose }: { folders: Folder[]; onClose: () => void }) {
  const toast = useToast();
  const { createFeed } = useSubscriptionMutations();
  const [url, setUrl] = useState('');
  const [cands, setCands] = useState<FeedCandidate[] | null>(null);
  const [chosen, setChosen] = useState<FeedCandidate | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0); // 古い discover 応答を破棄するための連番

  const discover = async () => {
    const v = url.trim();
    if (!v || busy) return;
    const mine = ++seq.current;
    setBusy(true);
    setChosen(null);
    try {
      const r = await api.discoverFeed(v.includes('://') ? v : 'https://' + v);
      if (mine === seq.current) {
        setCands(r);
        if (r.length === 1) setChosen(r[0]);
      }
    } catch {
      if (mine === seq.current) setCands([]);
    } finally {
      if (mine === seq.current) setBusy(false);
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
    <FormDialog
      title="フィードを追加"
      subtitle="サイトの URL からフィードを自動で探します。"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button label="キャンセル" variant="ghost" onClick={onClose} />
          <Button label="追加" variant="primary" onClick={add} isDisabled={!chosen} isLoading={createFeed.isPending} />
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              label="URL"
              type="url"
              value={url}
              onChange={(v) => {
                // URL を変えたら、古い候補・選択は無効にする
                seq.current++;
                setUrl(v);
                setCands(null);
                setChosen(null);
                setBusy(false);
              }}
              onEnter={discover}
              placeholder="https://example.com"
              hasAutoFocus
              width="100%"
            />
          </div>
          <Button label="探す" onClick={discover} isLoading={busy} isDisabled={!url.trim()} />
        </div>

        {cands && cands.length === 0 && (
          <Text type="supporting" color="secondary">
            フィードが見つかりませんでした
          </Text>
        )}
        {cands && cands.length > 0 && (
          <div className="flex flex-col gap-1">
            <Text type="label">検出されたフィード</Text>
            <List edge="flush" hasDividers>
              {cands.map((c) => (
                <ListItem
                  key={c.feedUrl}
                  label={c.title ?? c.feedUrl}
                  description={`${c.feedUrl}${c.type ? ` · ${c.type}` : ''}`}
                  isSelected={chosen?.feedUrl === c.feedUrl}
                  onClick={() => setChosen(c)}
                  endContent={chosen?.feedUrl === c.feedUrl ? <Icon icon="check" color="accent" /> : undefined}
                />
              ))}
            </List>
          </div>
        )}

        <Selector label="フォルダ" options={folderOptions(folders)} value={folder} onChange={(v) => setFolder(v ?? '')} width="100%" />
      </div>
    </FormDialog>
  );
}
