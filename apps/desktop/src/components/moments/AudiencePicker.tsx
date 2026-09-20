import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, theme } from 'antd';
import { Globe, Users } from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';

// Audience picker for the composer.
//
// Only fully wired audiences are shown. Unsupported modes stay out of
// the composer instead of appearing as disabled future-work clutter.

interface AudiencePickerProps {
  value: Audience;
  onChange: (next: Audience) => void;
  disabled?: boolean;
}

interface OptionDef {
  kind: Audience_Kind;
  i18nKey: string;
  Icon: typeof Globe;
}

// Order is the surface a user reads top-to-bottom: most public
// first, most private last, then the disabled-in-P2 options grouped.
const OPTIONS: OptionDef[] = [
  { kind: Audience_Kind.PUBLIC, i18nKey: 'moments.audience.public', Icon: Globe },
  { kind: Audience_Kind.FRIENDS, i18nKey: 'moments.audience.friends', Icon: Users },
];

export function AudiencePicker({ value, onChange, disabled }: AudiencePickerProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  const opts = useMemo(
    () =>
      OPTIONS.map((o) => ({
        value: o.kind,
        label: (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <o.Icon size={14} color={token.colorTextSecondary} />
            {t(o.i18nKey)}
          </span>
        ),
      })),
    [t, token.colorTextSecondary],
  );

  return (
    <Select
      value={value.kind}
      onChange={(kind) => {
        // Build a fresh `Audience` message rather than mutating the
        // previous one — the composer treats the value as immutable
        // for cheap React equality checks.
        const next = create(AudienceSchema, {
          kind,
          targetId: 0n,
          actorPtids: [],
        });
        onChange(next);
      }}
      options={opts}
      disabled={disabled}
      style={{ minWidth: 132 }}
      size="small"
      // popupMatchSelectWidth=false lets the dropdown widen to fit
      // the longer translated labels (e.g. "Followers only").
      popupMatchSelectWidth={false}
    />
  );
}
