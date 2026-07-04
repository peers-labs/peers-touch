import { DesktopShell } from '@peers-touch/prototype-desktop-shell';
import { AppletWorkspacePage } from './AppletWorkspacePrototype';

export function AppletWorkspacePrototype() {
  return (
    <DesktopShell
      initialPage="applets"
      pages={{
        applets: () => <AppletWorkspacePage />,
      }}
    />
  );
}
