import { Flexbox } from 'react-layout-kit';
import { Grid, theme } from 'antd';
import { ProviderMenu } from './ProviderMenu';
import { ProviderDetail } from './ProviderDetail';

export function ProviderLayout() {
  const { token } = theme.useToken();
  const wide = Grid.useBreakpoint().lg;

  return (
    <Flexbox horizontal={wide} style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Left panel - provider list */}
      <Flexbox
        style={{
          width: wide ? 260 : '100%',
          minWidth: wide ? 260 : 0,
          borderRight: wide ? `1px solid ${token.colorBorderSecondary}` : undefined,
          borderBottom: wide ? undefined : `1px solid ${token.colorBorderSecondary}`,
          height: wide ? '100%' : 220,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <ProviderMenu />
      </Flexbox>

      {/* Right panel - provider detail */}
      <Flexbox flex={1} style={{ overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
        <ProviderDetail />
      </Flexbox>
    </Flexbox>
  );
}
