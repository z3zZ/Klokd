import { useState } from 'react'
import { Wordmark } from '../components/Header.jsx'

export default function ConsentView({ onConsent }) {
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleStart = async () => {
    if (!checked || loading) return
    setLoading(true)
    await window.klokd.setConsent()
    onConsent()
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: 'var(--klokd-base)', padding: '0 24px',
      justifyContent: 'center',
    }}>
      <div style={{ marginBottom: 28 }}>
        <Wordmark />
      </div>

      <ConsentSection title="what klokd reads:">
        <ConsentItem>the name of your active application (e.g. chrome.exe)</ConsentItem>
        <ConsentItem>the title of your active window (e.g. "GitHub — klokd")</ConsentItem>
      </ConsentSection>

      <ConsentSection title="what klokd never reads:">
        <ConsentItem>keystrokes or typing</ConsentItem>
        <ConsentItem>the content of your windows or documents</ConsentItem>
        <ConsentItem>your files, clipboard, or browser history</ConsentItem>
        <ConsentItem>anything sent over the network</ConsentItem>
      </ConsentSection>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => setChecked(e.target.checked)}
          style={{ width: 14, height: 14, accentColor: 'var(--klokd-accent)', cursor: 'pointer', flexShrink: 0 }}
        />
        <span style={{ fontSize: 12, color: 'var(--klokd-text-secondary)' }}>I understand</span>
      </label>

      <button
        onClick={handleStart}
        disabled={!checked || loading}
        style={{
          marginTop: 14,
          padding: '10px 0',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          color: checked ? '#0D0D0D' : 'var(--klokd-text-muted)',
          background: checked ? 'var(--klokd-accent)' : 'var(--klokd-raised)',
          border: 'none',
          cursor: checked ? 'pointer' : 'default',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {loading ? 'starting…' : 'start klokd'}
      </button>
    </div>
  )
}

function ConsentSection({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
        color: 'var(--klokd-text-muted)', marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {children}
      </div>
    </div>
  )
}

function ConsentItem({ children }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--klokd-accent)', flexShrink: 0, fontSize: 12, lineHeight: '18px' }}>·</span>
      <span style={{ fontSize: 12, color: 'var(--klokd-text-secondary)', lineHeight: '18px' }}>{children}</span>
    </div>
  )
}
