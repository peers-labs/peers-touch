import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Tone } from '@peers-touch/ui-contracts';
import { Button } from './actions';
import { asActionTone } from '@peers-touch/ui-semantics';
import { Alert, ToastHost, createToastChannel, type ToastNotice } from './feedback';
import { Dialog } from './overlays';

export interface ConfirmationRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}
export interface AcknowledgementRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: Tone;
  onConfirm?: () => void;
}
interface PendingConfirmation extends ConfirmationRequest {
  id: string;
  settle: (confirmed: boolean) => void;
  acknowledge?: boolean;
  choices?: readonly { label: ReactNode }[];
  select?: (index: number) => void;
}
/** One channel belongs to one application window. The shell owns its host. */
export function createFeedbackChannel() {
  const notices = createToastChannel(), listeners = new Set<() => void>();
  let queue: readonly PendingConfirmation[] = [], serial = 0;
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    notices,
    notify: (notice: Omit<ToastNotice,'id'> & {id?:string}) => {
      const id=notice.id ?? `notice.${++serial}`;notices.publish({...notice,id});
      return ()=>notices.dismiss(id);
    },
    dismissNotice: notices.dismiss,
    requestConfirmation: (request: ConfirmationRequest): Promise<boolean> =>
      new Promise(resolve => { queue = [...queue,{...request,id:`confirm.${++serial}`,settle:resolve}]; emit(); }),
    requestAcknowledgement: (request: AcknowledgementRequest): Promise<void> =>
      new Promise(resolve => {
        queue = [...queue, { ...request, id: `ack.${++serial}`, acknowledge: true, settle: () => resolve(undefined) }];
        emit();
      }),
    requestChoice: (request: { title: ReactNode; choices: readonly { label: ReactNode }[]; cancelLabel?: string }): Promise<number | undefined> =>
      new Promise(resolve => {
        queue = [...queue, { ...request, id: `choice.${++serial}`, settle: () => resolve(undefined), select: resolve }];
        emit();
      }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => {listeners.delete(listener);}; },
    getSnapshot: () => queue,
    finish: (id: string, confirmed: boolean) => {
      const item = queue.find(item=>item.id===id);
      if (!item) return;
      queue = queue.filter(item=>item.id!==id); emit();
      if (!confirmed) item.onCancel?.();
      item.settle(confirmed);
    },
    choose: (id: string, index: number) => {
      const item = queue.find(item=>item.id===id);
      if (!item?.choices || !item.select || !Number.isInteger(index) || index < 0 || index >= item.choices.length) return;
      queue = queue.filter(item=>item.id!==id); emit(); item.select(index);
    },
    clear: () => {
      const pending = queue; queue = []; emit();
      for (const item of pending) item.settle(false);
    },
  };
}
export type FeedbackChannel = ReturnType<typeof createFeedbackChannel>;
export function FeedbackHost({channel}:{channel:FeedbackChannel}) {
  const queue = useSyncExternalStore(channel.subscribe,channel.getSnapshot);
  const current = queue[0], [pending,setPending] = useState(false), [failure,setFailure] = useState('');
  useEffect(()=>{setPending(false);setFailure('');},[current?.id]);
  return <><ToastHost channel={channel.notices}/>
    {current && <Dialog open title={current.title} description={current.description}
      onDismiss={()=>{if(!pending)channel.finish(current.id,false);}}
      footer={<>
        {!current.acknowledge && !current.choices && <Button actionId={`${current.id}.cancel`} label={current.cancelLabel ?? 'Cancel'}
          availability={pending?{kind:'disabled',reason:'Confirmation is running'}:undefined}
          onActivate={()=>channel.finish(current.id,false)}/>}
        {!current.choices && <Button actionId={current.id} label={current.confirmLabel ?? 'Confirm'} emphasis="primary" tone={asActionTone(current.tone)}
          execution={pending?'pending':'idle'} onActivate={async()=>{
            setPending(true);setFailure('');
            try { await current.onConfirm?.(); channel.finish(current.id,true); }
            catch(error) { setFailure(error instanceof Error ? error.message : String(error)); }
            finally { setPending(false); }
          }}/>}
      </>}>
        {current.choices && <div className="pt-choice-actions">{current.choices.map((choice,index)=>
          <Button key={index} actionId={`${current.id}.${index}`} fullWidth onActivate={()=>channel.choose(current.id,index)}>{choice.label}</Button>)}</div>}
        {failure && <Alert tone="danger" title={failure}/>}
      </Dialog>}
  </>;
}
