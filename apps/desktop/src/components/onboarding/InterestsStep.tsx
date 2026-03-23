import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Tag, theme } from 'antd';
import { Puzzle } from 'lucide-react';

const INTERESTS = [
  { id: 'programming', label: 'Programming & Development', available: true },
  { id: 'data', label: 'Data Analysis', available: false },
  { id: 'writing', label: 'Writing & Content', available: false },
  { id: 'research', label: 'Web Research', available: false },
  { id: 'devops', label: 'DevOps & Deployment', available: false },
  { id: 'design', label: 'Design & Prototyping', available: false },
];

interface Props {
  initial: string[];
  onNext: (selected: string[]) => void;
  onBack: () => void;
}

export function InterestsStep({ initial, onNext, onBack }: Props) {
  const [selected, setSelected] = useState<string[]>(initial.length > 0 ? initial : ['programming']);
  const { token } = theme.useToken();

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <Flexbox align="center" justify="center" gap={36} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={12}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #f093fb, #f5576c)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Puzzle size={28} color="#fff" />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: token.colorText, margin: 0 }}>
          Take your pick
        </h2>
        <p style={{ fontSize: 15, color: token.colorTextSecondary, margin: 0, textAlign: 'center' }}>
          What would you like Agent Box to help with?
        </p>
      </Flexbox>

      <Flexbox gap={10} style={{ width: '100%', maxWidth: 440 }} wrap="wrap" horizontal justify="center">
        {INTERESTS.map((item) => {
          const isSelected = selected.includes(item.id);
          return (
            <Tag.CheckableTag
              key={item.id}
              checked={isSelected}
              onChange={() => item.available && toggle(item.id)}
              style={{
                padding: '8px 18px',
                borderRadius: 20,
                fontSize: 14,
                cursor: item.available ? 'pointer' : 'not-allowed',
                opacity: item.available ? 1 : 0.5,
                border: isSelected ? `1px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`,
                userSelect: 'none',
              }}
            >
              {item.label}
              {!item.available && <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.6 }}>Coming soon</span>}
            </Tag.CheckableTag>
          );
        })}
      </Flexbox>

      <Flexbox horizontal gap={12}>
        <Button size="large" onClick={onBack} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Back
        </Button>
        <Button type="primary" size="large" onClick={() => onNext(selected)} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Next
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
