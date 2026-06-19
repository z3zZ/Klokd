// Renders an insight string. Numbers wrapped in <strong> are coloured accent.
function renderInsightText(text) {
  // Match sequences of digits, h/m suffixes, and % characters
  const parts = text.split(/(\d[\d\s]*(?:h\s*\d+m|\d+m|\d+h|%)?)/g)
  return parts.map((part, i) =>
    /^\d/.test(part)
      ? <strong key={i} style={{ color: 'var(--klokd-accent)', fontWeight: 'inherit' }}>{part}</strong>
      : part
  )
}

export default function InsightCard({ insights }) {
  if (!insights?.length) return null

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--klokd-text-muted)', marginBottom: 6 }}>
        insight
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {insights.slice(0, 2).map((ins, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--klokd-text-secondary)', lineHeight: 1.5 }}>
            {renderInsightText(ins.text)}
          </div>
        ))}
      </div>
    </div>
  )
}
