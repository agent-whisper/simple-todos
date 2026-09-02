import { useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { getToken } from './auth/session';

export function App() {
  const [token, setTokenState] = useState(getToken());
  if (!token) return <LoginScreen onSignedIn={() => setTokenState(getToken())} />;
  return <p>Signed in.</p>;
}
