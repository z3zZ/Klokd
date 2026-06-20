import { useEffect, useState } from 'react'

export function Wordmark() {
  return (
    <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: 'var(--klokd-text-primary)', letterSpacing: '-0.02em' }}>
      kl<span style={{ color: 'var(--klokd-accent)' }}>o</span>kd
    </span>
  )
}

export function ClockDisplay() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="mono" style={{ fontSize: 12, color: 'var(--klokd-text-muted)' }}>
      {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
    </span>
  )
}
