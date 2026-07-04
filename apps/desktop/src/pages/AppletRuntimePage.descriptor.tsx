import { registerPage } from '../kernel/page';
import { usePageContext } from '../kernel/usePageContext';
import { AppletRuntimePage } from './AppletRuntimePage';

function AppletRuntimeRoute({ pageId }: { pageId: string }) {
  const { appletPins } = usePageContext();
  const appletId = pageId.slice('applet:'.length);

  return (
    <AppletRuntimePage
      appletId={appletId}
      onPin={() => appletPins.togglePin(appletId)}
      pinned={appletPins.pinnedApplets.includes(appletId)}
    />
  );
}

export function registerAppletRuntimePage(): void {
  registerPage({
    id: 'applet:*',
    title: 'Applet Runtime',
    match: (pageId) => pageId.startsWith('applet:') && pageId.length > 'applet:'.length,
    factory: ({ pageId }) => <AppletRuntimeRoute pageId={pageId} />,
    preload: 'on-visit',
    // Kernel-single-authority (§6.1): the applet page frame stays resident; the
    // AppletKernel.ResourceScheduler is the sole LRU/TTL/memory-pressure authority.
    // No page-level LRU here — that would recreate the eliminated "double LRU".
    keepAlive: 'forever',
    runtimes: ['applets'],
  });
}
