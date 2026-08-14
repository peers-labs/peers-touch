// PageDescriptor for the home (landing) page.
//
// Home is an overview page — preloaded eagerly so the user sees content
// immediately when switching to it. keepAlive: 'forever' preserves the
// rendered state across tab switches.

import { registerPage } from '../kernel/page';
import { HomePageContainer } from './HomePageContainer';

export function registerHomePage(): void {
  registerPage({
    id: 'home',
    title: 'Home',
    factory: () => <HomePageContainer />,
    preload: 'eager',
    keepAlive: 'forever',
    runtimes: [],
  });
}
