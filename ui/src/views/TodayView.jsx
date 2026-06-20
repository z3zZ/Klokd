import { useEffect, useState } from 'react'
import CategoryBar from '../components/CategoryBar.jsx'
import InsightCard from '../components/InsightCard.jsx'
import Nav from '../components/Nav.jsx'
import { Wordmark, ClockDisplay } from '../components/Header.jsx'
import { formatTime } from '../utils.js'

const REFRESH_MS = 30_000

export default function TodayView({ onNavigate, currentView }) {
  const [summary, setSummary] = useState({ categories: [], totalSeconds: 0 })
  const [insights, setInsights] = useState([])

  useEffect(() => {
    function refresh() {
      window.klokd.getTodaySummary().then(setSummary)
      window.klokd.getInsights().then(setInsights)
    }
    refresh()
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--klokd-base)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
        <Wordmark />
        <ClockDisplay />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
        <div style={{ paddingTop: 4, paddingBottom: 12 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--klokd-text-muted)', marginBottom: 4 }}>
            today
          </div>
          <div style={{ fontSize: 15, fontStyle: 'italic', color: 'var(--klokd-text-primary)' }}>
            your day, <span style={{ color: 'var(--klokd-accent)' }}>kloked.</span>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <CategoryBar categories={summary.categories} />
        </div>

        <div style={{ marginBottom: 20 }}>
          {summary.categories.length === 0 ? (
            <div style={{ color: 'var(--klokd-text-muted)', fontSize: 12 }}>no data yet today</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {summary.categories.map(cat => (
                <div key={cat.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, color: 'var(--klokd-text-secondary)' }}>{cat.label}</div>
                  <div className="mono" style={{ color: 'var(--klokd-text-primary)', fontSize: 12 }}>
                    {formatTime(cat.seconds)}
                  </div>
                  <div className="mono" style={{ color: 'var(--klokd-text-muted)', fontSize: 11, width: 32, textAlign: 'right' }}>
                    {cat.pct}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {insights.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <InsightCard insights={insights} />
          </div>
        )}
      </div>

      <Nav current={currentView} onNavigate={onNavigate} />
    </div>
  )
}
