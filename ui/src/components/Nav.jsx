const TABS = [
  { key: 'today', label: 'today' },
  { key: 'week', label: 'week' },
  { key: 'apps', label: 'apps' },
  { key: 'settings', label: 'settings' },
]

export default function Nav({ current, onNavigate }) {
  return (
    <div style={{
      display: 'flex',
      gap: 4,
      padding: '8px 16px 14px',
      borderTop: '0.5px solid var(--klokd-border)',
    }}>
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => onNavigate(t.key)}
          style={{
            flex: 1,
            fontSize: 11,
            color: current === t.key ? 'var(--klokd-text-secondary)' : 'var(--klokd-text-muted)',
            border: `0.5px solid ${current === t.key ? 'var(--klokd-border)' : 'transparent'}`,
            borderRadius: 6,
            padding: '5px 0',
            transition: 'color 0.1s, border-color 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--klokd-text-secondary)'; e.currentTarget.style.borderColor = 'var(--klokd-text-muted)' }}
          onMouseLeave={e => { e.currentTarget.style.color = current === t.key ? 'var(--klokd-text-secondary)' : 'var(--klokd-text-muted)'; e.currentTarget.style.borderColor = current === t.key ? 'var(--klokd-border)' : 'transparent' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
