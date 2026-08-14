// PageDescriptor for the tasks page.
//
// Tasks is a management UI for creating and tracking agent tasks.
// Loaded on-visit since it is not a primary landing.
// keepAlive: { lru: 1 } preserves state when switching tabs briefly.

import { registerPage } from '../kernel/page';
import { TasksPageContainer } from './TasksPageContainer';

export function registerTasksPage(): void {
  registerPage({
    id: 'tasks',
    title: 'Tasks',
    factory: () => <TasksPageContainer />,
    preload: 'on-visit',
    keepAlive: { lru: 1 },
    runtimes: [],
  });
}
