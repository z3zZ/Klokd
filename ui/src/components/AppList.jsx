import { useEffect, useState } from 'react'
import { formatTime } from '../utils.js'
import Nav from './Nav.jsx'
import { Wordmark, ClockDisplay } from './Header.jsx'

export default function AppList({ onNavigate, currentView }) {
  const [apps, setApps] = useState([])

  useEffect(() => {
    window.klokd.getTopApps().then(setApps)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--klokd-base)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
        <Wordmark />
        <ClockDisplay />
      </div>

      <div style={{ padding: '0 16px 8px', flex: 1, overflow: 'auto' }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--klokd-text-muted)', marginBottom: 10 }}>
          today · top apps
        </div>

        {apps.length === 0 ? (
          <div style={{ color: 'var(--klokd-text-muted)', fontSize: 12, paddingTop: 20 }}>
            no data yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {apps.map(app => (
              <div key={app.exe} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 0',
                borderBottom: '0.5px solid var(--klokd-border)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: app.color, flexShrink: 0 }} />
                <div style={{ flex: 1, color: 'var(--klokd-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {app.label}
                </div>
                <div className="mono" style={{ color: 'var(--klokd-text-primary)', fontSize: 12 }}>
                  {formatTime(app.seconds)}
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
