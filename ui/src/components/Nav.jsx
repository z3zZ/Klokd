import { useState } from 'react'

const TABS = [
  { key: 'today', label: 'today' },
  { key: 'week', label: 'week' },
  { key: 'apps', label: 'apps' },
  { key: 'settings', label: 'settings' },
]

export default function Nav({ current, onNavigate }) {
  const [hovered, setHovered] = useState(null)

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      padding: '8px 16px 14px',
      borderTop: '0.5px solid var(--klokd-border)',
    }}>
      {TABS.map(t => {
        const isActive = current === t.key
        const isHovered = hovered === t.key
        return (
          <button
            key={t.key}
            onClick={() => onNavigate(t.key)}
            onMouseEnter={() => setHovered(t.key)}
            onMouseLeave={() => setHovered(null)}
            style={{
              flex: 1,
              fontSize: 11,
              color: (isActive || isHovered) ? 'var(--klokd-text-secondary)' : 'var(--klokd-text-muted)',
              border: `0.5px solid ${(isActive || isHovered) ? 'var(--klokd-border)' : 'transparent'}`,
              borderRadius: 6,
              padding: '5px 0',
              transition: 'color 0.1s, border-color 0.1s',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
