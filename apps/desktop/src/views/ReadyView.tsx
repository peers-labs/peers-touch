import { useEffect } from 'react';
import { GlobalLayout } from '../components/GlobalLayout';
import { AppSideNav } from '../components/AppSideNav';
import { PageRouter } from '../components/PageRouter';
import { useHashRouter } from '../hooks/useHashRouter';
import { useNavigation } from '../hooks/useNavigation';
import { useAppletPins } from '../hooks/useAppletPins';
import AppletManager from '../applet/AppletManager';
import type { AppLifecycle } from '../types/navigation';

interface ReadyViewProps {
  lifecycle: AppLifecycle;
}

export function ReadyView({ lifecycle: _lifecycle }: ReadyViewProps) {
  const router = useHashRouter();
  const navigation = useNavigation(router);
  const appletPins = useAppletPins();
  const appletManager = AppletManager.getInstance();

  useEffect(() => {
    appletManager.scanApplets().catch(() => {});
  }, [appletManager]);

  return (
    <GlobalLayout
      sideNav={
        <AppSideNav
          page={router.page}
          router={router}
          navigation={navigation}
          appletPins={appletPins}
        />
      }
    >
      <PageRouter
        page={router.page}
        router={router}
        navigation={navigation}
        appletPins={appletPins}
      />
    </GlobalLayout>
  );
}
