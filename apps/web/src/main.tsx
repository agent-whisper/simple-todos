import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';

// retry:false matters — a 401 must reach the app immediately so it can return to
// login, not be retried three times first with a token that cannot work.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 5_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
