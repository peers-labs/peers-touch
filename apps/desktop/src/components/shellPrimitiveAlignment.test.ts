// Source-contract: the in-scope shell and social-chat shared primitives must
// render through @peers-touch/ui and --pt-* tokens, not antd / @lobehub.
// Agent and moments surfaces are intentionally out of scope.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('shell and shared-chat primitive alignment', () => {
  it('PresentedErrorAlert uses the peers Alert with mapped tone', () => {
    const source = read('./common/PresentedErrorAlert.tsx');
    expect(source).not.toMatch(/from 'antd'/);
    expect(source).toMatch(/import \{ Alert \} from '@peers-touch\/ui'/);
    expect(source).toMatch(/tone=\{tone\}/);
    expect(source).toMatch(/onDismiss=\{onClose\}/);
  });

  it('FederatedHandle paints with pt tokens instead of antd Typography/theme', () => {
    const source = read('./FederatedHandle.tsx');
    expect(source).not.toMatch(/from 'antd'/);
    expect(source).not.toContain('theme.useToken');
    expect(source).toContain('var(--pt-secondary)');
    expect(source).toContain('pt-federated-handle');
  });

  it('GroupCompositeAvatar resolves fill/text colors from pt tokens', () => {
    const source = read('./common/GroupCompositeAvatar.tsx');
    expect(source).not.toMatch(/from 'antd'/);
    expect(source).not.toContain('theme.useToken');
    expect(source).toContain('var(--pt-subtle)');
    expect(source).toContain('var(--pt-secondary)');
  });

  it('errorPresenter routes toasts through the peers feedback channel', () => {
    const source = read('../services/errorPresenter.ts');
    expect(source).not.toMatch(/@lobehub/);
    expect(source).toContain("from '../ui/feedback'");
    expect(source).toContain('feedbackChannel.notify');
    expect(source).toContain("'danger'");
  });

  it('CommandMenu uses the prototype palette shell with peers glyphs', () => {
    const source = read('./CommandMenu.tsx');
    expect(source).not.toMatch(/from 'antd'/);
    expect(source).not.toMatch(/@lobehub/);
    expect(source).not.toContain('react-layout-kit');
    expect(source).toMatch(/import \{ Icon \} from '@peers-touch\/ui'/);
    expect(source).toContain('pt-search-overlay');
    expect(source).toContain('pt-search-panel pt-command-panel');
    expect(source).toContain('pt-search-row-target');
  });

  it('useAppRuntime presents revocation through peers acknowledgement', () => {
    const source = read('../hooks/useAppRuntime.ts');
    expect(source).not.toMatch(/from 'antd'/);
    expect(source).not.toContain('Modal.warning');
    expect(source).toContain('acknowledgeRequest');
  });

  it('LoginPage surfaces notices through the peers feedback channel', () => {
    const source = read('../pages/login/LoginPage.tsx');
    expect(source).not.toMatch(/from 'antd'/);
    expect(source).not.toContain('message.error');
    expect(source).not.toContain('notification.warning');
    expect(source).toContain('notifyError');
    expect(source).toContain('feedbackChannel.notify');
  });

  it('ClientMetaPanel uses peers Tag and pt tokens in settings logs', () => {
    const source = read('./debug/ClientMetaPanel.tsx');
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).toMatch(/import \{ Tag \} from ['"]@peers-touch\/ui['"]/);
    expect(source).not.toContain('theme.useToken');
    expect(source).toContain('var(--pt-muted)');
  });
});
