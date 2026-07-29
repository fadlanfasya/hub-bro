import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

// Note: StrictMode is intentionally not used. Its development-only double-mount
// re-runs the grid's init effect, which leaves gridstack holding stale item
// nodes and makes dragging misbehave.
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
