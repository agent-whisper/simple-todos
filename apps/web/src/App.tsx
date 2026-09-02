import { useCallback, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoginScreen } from './auth/LoginScreen';
import { getToken } from './auth/session';
import { AppShell } from './shell/AppShell';

/** Placeholder until each screen's own task lands. */
function Placeholder({ name }: { name: string }) {
  return <h1>{name}</h1>;
}

export function App() {
  const [token, setTokenState] = useState(getToken);
  const refresh = useCallback(() => setTokenState(getToken()), []);

  if (!token) return <LoginScreen onSignedIn={refresh} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell onSignedOut={refresh} />}>
          <Route index element={<Placeholder name="Active" />} />
          <Route path="archive" element={<Placeholder name="Archive" />} />
          <Route path="repeating" element={<Placeholder name="Repeating" />} />
          <Route path="notes" element={<Placeholder name="Notes" />} />
          <Route path="settings" element={<Placeholder name="Settings" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
