import '@renderer/styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@renderer/App'
import { installPreviewBridge } from '@renderer/lib/preview-bridge'

// Browser preview (pnpm web): no preload script exists, so install a mock bridge.
installPreviewBridge()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
