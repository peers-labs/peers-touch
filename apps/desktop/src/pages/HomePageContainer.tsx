// Container for the home page descriptor — bridges the kernel page
// context into HomePage's rendering. Kept in its own file so the
// descriptor module exports only the register function.

import { HomePage } from './HomePage';

export function HomePageContainer() {
  return <HomePage />;
}
