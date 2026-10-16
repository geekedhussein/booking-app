import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { App } from './App.jsx';
// Fonts are self-hosted (bundled by Vite): no third-party request, no visitor
// IPs sent to a font CDN, and they work offline / behind strict CSPs.
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/schibsted-grotesk';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Retry only what might succeed on a second try: network blips and 5xx.
      // A 4xx (validation, not found, forbidden) will fail the same way again.
      retry: (count, error) => (error?.status === 0 || error?.status >= 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
