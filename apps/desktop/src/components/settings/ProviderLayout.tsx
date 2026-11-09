import { ProviderMenu } from './ProviderMenu';
import { ProviderDetail } from './ProviderDetail';

export function ProviderLayout() {
  return (
    <div className="sc-provider-layout">
      {/* Left panel - provider list */}
      <div className="sc-provider-layout__menu">
        <ProviderMenu />
      </div>

      {/* Right panel - provider detail */}
      <div className="sc-provider-layout__detail">
        <ProviderDetail />
      </div>
    </div>
  );
}
