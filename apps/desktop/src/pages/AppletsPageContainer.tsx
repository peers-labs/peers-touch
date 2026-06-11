import { usePageContext } from '../kernel/usePageContext';
import { AppletsPage } from './AppletsPage';

export function AppletsPageContainer() {
  const { navigation } = usePageContext();
  return <AppletsPage onNavigate={(page) => navigation.navigateTo(page)} />;
}
