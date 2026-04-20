/**
 * Hash-based page router component.
 * Maps the current page identifier to the corresponding page component.
 *
 * Created: 2026-04-10 — Extracted from DashboardLayout to separate
 * routing logic from layout concerns.
 */

import type { Page } from '../utils/constants';
import { PAGES } from '../utils/constants';
import OverviewPage from '../pages/OverviewPage';
import ActorsPage from '../pages/ActorsPage';
import SessionsPage from '../pages/SessionsPage';
import NodesPage from '../pages/NodesPage';
import SubServersPage from '../pages/SubServersPage';
import FederationPage from '../pages/FederationPage';
import StoragePage from '../pages/StoragePage';
import SecurityPage from '../pages/SecurityPage';
import SystemPage from '../pages/SystemPage';
import LogsPage from '../pages/LogsPage';
import TransportPage from '../pages/TransportPage';

interface Props {
  page: Page;
}

export default function PageRouter({ page }: Props) {
  switch (page) {
    case PAGES.OVERVIEW:   return <OverviewPage />;
    case PAGES.ACTORS:     return <ActorsPage />;
    case PAGES.SESSIONS:   return <SessionsPage />;
    case PAGES.NODES:      return <NodesPage />;
    case PAGES.SUBSERVERS: return <SubServersPage />;
    case PAGES.FEDERATION: return <FederationPage />;
    case PAGES.STORAGE:    return <StoragePage />;
    case PAGES.SECURITY:   return <SecurityPage />;
    case PAGES.SYSTEM:     return <SystemPage />;
    case PAGES.LOGS:       return <LogsPage />;
    case PAGES.TRANSPORT:  return <TransportPage />;
    default:               return <OverviewPage />;
  }
}
