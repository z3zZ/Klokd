import { useState } from 'react'
import { formatTime } from '../utils.js'

export default function CategoryBar({ categories }) {
  const [tooltip, setTooltip] = useState(null)

  if (!categories?.length) {
    return (
      <div style={{ height: 8, background: 'var(--klokd-raised)', borderRadius: 4 }} />
    )
  }

  const total = categories.reduce((s, c) => s + c.seconds, 0)

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 1, height: 8, borderRadius: 4, overflow: 'hidden' }}>
        {categories.map(cat => (
          <div
            key={cat.key}
            style={{
              flex: cat.seconds / total,
              background: cat.color,
              cursor: 'default',
              minWidth: 2,
            }}
            onMouseEnter={e => setTooltip({ cat, x: e.clientX })}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </div>

      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x,
          top: 'auto',
          transform: 'translate(-50%, -36px)',
          background: 'var(--klokd-surface)',
          border: '0.5px solid var(--klokd-border)',
          borderRadius: 4,
          padding: '3px 7px',
          fontSize: 11,
          color: 'var(--klokd-text-primary)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 9999,
        }}>
          {tooltip.cat.label} · {formatTime(tooltip.cat.seconds)}
        </div>
      )}
    </div>
  )
}
