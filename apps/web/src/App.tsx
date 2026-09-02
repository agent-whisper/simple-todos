import { useCallback, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoginScreen } from './auth/LoginScreen';
import { getToken } from './auth/session';
import { ActiveScreen } from './screens/ActiveScreen';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { NotesScreen } from './screens/NotesScreen';
import { RepeatablesScreen } from './screens/RepeatablesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppShell } from './shell/AppShell';

export function App() {
  const [token, setTokenState] = useState(getToken);
  const refresh = useCallback(() => setTokenState(getToken()), []);

  if (!token) return <LoginScreen onSignedIn={refresh} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell onSignedOut={refresh} />}>
          <Route index element={<ActiveScreen />} />
          <Route path="archive" element={<ArchiveScreen />} />
          <Route path="repeating" element={<RepeatablesScreen />} />
          <Route path="notes" element={<NotesScreen />} />
          <Route path="settings" element={<SettingsScreen onSignedOut={refresh} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
