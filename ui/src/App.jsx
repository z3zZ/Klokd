import { useState } from 'react'
import TodayView from './views/TodayView.jsx'
import WeekView from './views/WeekView.jsx'
import SettingsView from './views/SettingsView.jsx'
import AppList from './components/AppList.jsx'

const VIEWS = { today: TodayView, week: WeekView, apps: AppList, settings: SettingsView }

export default function App() {
  const [view, setView] = useState('today')
  const View = VIEWS[view]
  return <View onNavigate={setView} currentView={view} />
}
