import { Flexbox } from 'react-layout-kit';
import { theme } from 'antd';
import { ProviderMenu } from './ProviderMenu';
import { ProviderDetail } from './ProviderDetail';

export function ProviderLayout() {
  const { token } = theme.useToken();

  return (
    <Flexbox horizontal style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Left panel - provider list */}
      <Flexbox
        style={{
          width: 220,
          minWidth: 220,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <ProviderMenu />
      </Flexbox>

      {/* Right panel - provider detail */}
      <Flexbox flex={1} style={{ height: '100%', overflow: 'hidden', minWidth: 0 }}>
        <ProviderDetail />
      </Flexbox>
    </Flexbox>
  );
}
