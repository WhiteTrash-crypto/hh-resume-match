import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const titlePrefix = import.meta.env.VITE_TITLE_PREFIX
if (typeof titlePrefix === 'string' && titlePrefix && !document.title.startsWith(titlePrefix)) {
  document.title = `${titlePrefix}${document.title}`
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
