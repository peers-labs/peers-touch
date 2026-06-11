import { registerPage } from '../kernel/page';
import { AppletsPageContainer } from './AppletsPageContainer';

export function registerAppletsPage(): void {
  registerPage({
    id: 'applets',
    title: 'Applets',
    factory: () => <AppletsPageContainer />,
    preload: 'idle',
    keepAlive: 'forever',
    runtimes: ['applets'],
  });
}
