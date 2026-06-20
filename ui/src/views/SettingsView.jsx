import { useEffect, useState } from 'react'
import Nav from '../components/Nav.jsx'
import { Wordmark } from '../components/Header.jsx'

export default function SettingsView({ onNavigate, currentView }) {
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [pollInterval, setPollInterval] = useState(5)
  const [catsYaml, setCatsYaml] = useState('')
  const [saveStatus, setSaveStatus] = useState(null)

  useEffect(() => {
    window.klokd.getAutoLaunchEnabled().then(r => setAutoLaunch(r.enabled))
    window.klokd.getSettings().then(r => setPollInterval(r.pollInterval))
    window.klokd.getCategoriesYaml().then(r => setCatsYaml(r.content))
  }, [])

  const handleAutoLaunchToggle = async () => {
    const next = !autoLaunch
    const result = await window.klokd.setAutoLaunch(next)
    if (result.ok) setAutoLaunch(next)
  }

  const handleSaveCategories = async () => {
    const result = await window.klokd.setCategoriesYaml(catsYaml)
    if (result.ok) {
      await window.klokd.recategoriseAll()
      setSaveStatus('saved')
    } else {
      setSaveStatus('error: ' + result.error)
    }
    setTimeout(() => setSaveStatus(null), 2500)
  }

  const handleSavePollInterval = async () => {
    await window.klokd.setPollInterval(Number(pollInterval))
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(null), 2500)
  }

  const handleExport = () => window.klokd.exportData()
  const handleDelete = () => window.klokd.deleteAllData()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--klokd-base)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
        <Wordmark />
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--klokd-text-muted)' }}>
          settings
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>

        {/* Launch at startup */}
        <Row label="launch at startup">
          <Toggle checked={autoLaunch} onChange={handleAutoLaunchToggle} />
        </Row>

        {/* Poll interval */}
        <Row label="poll interval (seconds)">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="number"
              value={pollInterval}
              min={1}
              max={60}
              style={{ width: 54 }}
              onChange={e => setPollInterval(e.target.value)}
            />
            <button onClick={handleSavePollInterval} style={btnStyle}>save</button>
          </div>
        </Row>

        {/* Categories YAML */}
        <div style={{ marginBottom: 14 }}>
          <Label>categories.yaml</Label>
          <textarea
            value={catsYaml}
            onChange={e => setCatsYaml(e.target.value)}
            style={{ width: '100%', height: 140, fontSize: 11, fontFamily: 'monospace' }}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <button onClick={handleSaveCategories} style={btnStyle}>save &amp; reclassify</button>
            {saveStatus && (
              <span style={{ fontSize: 11, color: saveStatus.startsWith('error') ? '#E8785A' : 'var(--klokd-accent)' }}>
                {saveStatus}
              </span>
            )}
          </div>
        </div>

        {/* Data */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button onClick={handleExport} style={{ ...btnStyle, flex: 1 }}>export data</button>
          <button onClick={handleDelete} style={{ ...btnStyle, flex: 1, color: '#E8785A', borderColor: '#E8785A33' }}>
            delete all data
          </button>
        </div>

        {/* Privacy note */}
        <div style={{ fontSize: 11, color: 'var(--klokd-text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
          klokd reads only your active window name and title.
          No keystrokes, content, or network data. Ever.
        </div>
      </div>

      {/* Version */}
      <div style={{ padding: '0 16px 6px', textAlign: 'right', fontSize: 10, color: 'var(--klokd-text-muted)' }}>
        v1.0.0
      </div>

      <Nav current={currentView} onNavigate={onNavigate} />
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '0.5px solid var(--klokd-border)' }}>
      <span style={{ color: 'var(--klokd-text-secondary)', fontSize: 12 }}>{label}</span>
      {children}
    </div>
  )
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--klokd-text-muted)', marginBottom: 6, marginTop: 14 }}>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={onChange}
      style={{
        width: 34, height: 18, borderRadius: 9,
        background: checked ? 'var(--klokd-accent)' : 'var(--klokd-raised)',
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      <div style={{
        position: 'absolute',
        top: 2, left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: checked ? '#0D0D0D' : 'var(--klokd-text-muted)',
        transition: 'left 0.15s',
      }} />
    </div>
  )
}

const btnStyle = {
  fontSize: 11,
  color: 'var(--klokd-text-muted)',
  border: '0.5px solid var(--klokd-border)',
  borderRadius: 6,
  padding: '5px 10px',
  cursor: 'pointer',
}
