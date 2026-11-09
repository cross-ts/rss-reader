import { useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { TextInput } from '@astryxdesign/core/TextInput';

/** Dialog の共通骨組み: ヘッダー / 本文 / 右寄せのフッター。 */
export function FormDialog(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Dialog isOpen onOpenChange={(o) => !o && props.onClose()} purpose="form" width={props.width ?? 440}>
      <Layout
        height="auto"
        header={<DialogHeader title={props.title} subtitle={props.subtitle} onOpenChange={(o) => !o && props.onClose()} />}
        content={<LayoutContent>{props.children}</LayoutContent>}
        footer={
          <LayoutFooter>
            <div className="flex justify-end gap-2">{props.footer}</div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** 1 行入力のダイアログ（フォルダ作成・改名、フィード改名）。 */
export function PromptDialog(props: {
  title: string;
  label: string;
  description?: string;
  value?: string;
  okLabel: string;
  onSubmit: (v: string) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(props.value ?? '');
  const trimmed = v.trim();
  const canSubmit = trimmed !== '' && trimmed !== (props.value ?? '').trim();
  const submit = () => {
    if (!canSubmit) return;
    props.onSubmit(trimmed);
    props.onClose();
  };
  return (
    <FormDialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button label="キャンセル" variant="ghost" onClick={props.onClose} />
          <Button label={props.okLabel} variant="primary" isDisabled={!canSubmit} onClick={submit} />
        </>
      }
    >
      <TextInput
        label={props.label}
        description={props.description}
        value={v}
        onChange={setV}
        onEnter={submit}
        hasAutoFocus
        width="100%"
      />
    </FormDialog>
  );
}
