import { useEffect, useState } from 'react'
import TodayView from './views/TodayView.jsx'
import WeekView from './views/WeekView.jsx'
import SettingsView from './views/SettingsView.jsx'
import AppList from './components/AppList.jsx'
import ConsentView from './views/ConsentView.jsx'

const VIEWS = { today: TodayView, week: WeekView, apps: AppList, settings: SettingsView }

export default function App() {
  const [consented, setConsented] = useState(null)
  const [view, setView] = useState('today')

  useEffect(() => {
    window.klokd.getConsentStatus().then(({ given }) => setConsented(given))
  }, [])

  if (consented === null) return null

  if (!consented) return <ConsentView onConsent={() => setConsented(true)} />

  const View = VIEWS[view]
  return <View onNavigate={setView} currentView={view} />
}
