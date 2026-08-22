import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import './styles.css'
import { AuthProvider, LangProvider, useAuth, useT } from './state'
import { Footer, Header, Problem } from './ui'
import Landing from './Landing'
import Booking from './Booking'
import Bill from './Bill'
import Login from './Login'
import Account from './Account'
import Dashboard from './doctor/Dashboard'
import Patients from './doctor/Patients'
import Analytics from './doctor/Analytics'
import Schedule from './doctor/Schedule'

function Guard({ doctor, children }: { doctor?: boolean; children: ReactNode }) {
  const { user, ready } = useAuth()
  const { t } = useT()
  const location = useLocation()

  if (!ready) return <p className="muted pad">{t('loading')}</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (doctor && !user.isDoctor) return <Problem message={t('errDoctorOnly')} />
  return <>{children}</>
}

function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/book" element={<Booking />} />
          <Route path="/login" element={<Login />} />
          <Route path="/bill/:id" element={<Guard><Bill /></Guard>} />
          <Route path="/account" element={<Guard><Account /></Guard>} />
          <Route path="/doctor" element={<Guard doctor><Dashboard /></Guard>} />
          <Route path="/doctor/patients" element={<Guard doctor><Patients /></Guard>} />
          <Route path="/doctor/patients/:id" element={<Guard doctor><Patients /></Guard>} />
          <Route path="/doctor/schedule" element={<Guard doctor><Schedule /></Guard>} />
          <Route path="/doctor/analytics" element={<Guard doctor><Analytics /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </LangProvider>
  </StrictMode>,
)
