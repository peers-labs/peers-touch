import { ToastHost as LobeToastHost, toast } from '@lobehub/ui';

export { toast };

export function ToastHost() {
  return <LobeToastHost duration={2200} position="bottom-right" />;
}
