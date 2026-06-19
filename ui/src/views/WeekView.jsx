import { useEffect, useState } from 'react'
import Nav from '../components/Nav.jsx'
import { formatTime } from '../utils.js'

export default function WeekView({ onNavigate, currentView }) {
  const [trends, setTrends] = useState([])
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    window.klokd.getWeekTrends().then(data => {
      setTrends(data)
      if (data.length > 0) setSelected(data[data.length - 1])
    })
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--klokd-base)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
        <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: 'var(--klokd-text-primary)', letterSpacing: '-0.02em' }}>
          kl<span style={{ color: 'var(--klokd-accent)' }}>o</span>kd
        </span>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--klokd-text-muted)' }}>
          7 days
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
        {/* Stacked day bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {trends.map(day => {
            const isToday = day.date === today
            const isSelected = selected?.date === day.date
            const total = day.categories.reduce((s, c) => s + c.seconds, 0)
            const label = new Date(day.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })

            return (
              <div key={day.date}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={() => setSelected(day)}
              >
                <div style={{
                  width: 28,
                  fontSize: 10,
                  color: isToday ? 'var(--klokd-text-primary)' : 'var(--klokd-text-muted)',
                  textAlign: 'right',
                  flexShrink: 0,
                }}>
                  {label}
                </div>
                <div style={{
                  flex: 1, height: 10, borderRadius: 3,
                  background: 'var(--klokd-raised)',
                  overflow: 'hidden',
                  display: 'flex',
                  gap: 1,
                  opacity: isToday ? 1 : 0.65,
                  outline: isSelected ? '1px solid var(--klokd-text-muted)' : 'none',
                  outlineOffset: 1,
                }}>
                  {total > 0 && day.categories.map(cat => (
                    <div key={cat.key} style={{
                      flex: cat.seconds / total,
                      background: cat.color,
                      minWidth: 2,
                    }} />
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--klokd-text-muted)', width: 34, textAlign: 'right', flexShrink: 0 }}>
                  {total > 0 ? formatTime(total) : '—'}
                </div>
              </div>
            )
          })}
        </div>

        {/* Selected day breakdown */}
        {selected && selected.categories.length > 0 && (
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--klokd-text-muted)', marginBottom: 8 }}>
              {new Date(selected.date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            {[...selected.categories].sort((a, b) => b.seconds - a.seconds).map(cat => (
              <div key={cat.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                <div style={{ flex: 1, color: 'var(--klokd-text-secondary)' }}>{cat.key}</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--klokd-text-primary)' }}>
                  {formatTime(cat.seconds)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Nav current={currentView} onNavigate={onNavigate} />
    </div>
  )
}
