// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App'
import { useGameStore } from './store/useGameStore'
import { tabFromPath } from './routes'
import { listenForInstall } from './components/common/installApp'
import { keepRemindersInStep } from './components/common/labReminders'

// Open the tab the address names (towerforge.net/creators → Creator Codes).
const tab = tabFromPath(window.location.pathname)
if (tab) useGameStore.getState().setActiveTab(tab)

// iPhones and iPads zoom the page in whenever a box with text under 16px
// is tapped (the site's are 13–15px) and leave it zoomed. maximum-scale
// stops that, and iOS still lets players pinch-zoom; other phones get
// no limit, since there it would block pinch-zoom (2026-11-09).
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const viewport = document.querySelector('meta[name="viewport"]')
if (iOS && viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1')

// Catch Chrome's install prompt for the home-screen hint, and keep lab reminders in step with imports.
listenForInstall()
keepRemindersInStep()

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
)