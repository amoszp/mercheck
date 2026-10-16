import { useCallback, useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './components/Login.jsx';
import { api } from './lib/api.js';
import { markImported, readLocalLists } from './lib/storage.js';

/**
 * Loads the server's lists for the signed-in user. The first time an account
 * has no lists, the ones this browser kept before accounts existed are copied in.
 */
async function loadLists() {
  const state = await api.get('/api/state');
  if (state.lists.length > 0) return state;
  const local = readLocalLists();
  if (!local) return state;
  const result = await api.post('/api/import', local);
  markImported();
  return result.state;
}

/** Decides between the sign-in screen and the app. */
export default function Root() {
  const [session, setSession] = useState({ phase: 'loading' });

  const start = useCallback(async () => {
    setSession({ phase: 'loading' });
    try {
      const { user } = await api.get('/api/auth/me');
      setSession({ phase: 'ready', user, lists: await loadLists() });
    } catch (err) {
      setSession({ phase: err.status === 401 ? 'login' : 'offline' });
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const signedOut = useCallback(() => setSession({ phase: 'login' }), []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Offline: the cookie stays, but this screen still signs out.
    }
    signedOut();
  }, [signedOut]);

  if (session.phase === 'login') return <Login onSignedIn={start} />;
  if (session.phase === 'ready') {
    return <App key={session.user.id} user={session.user} initialState={session.lists} onSignOut={signOut} onSignedOut={signedOut} />;
  }

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      {session.phase === 'offline' ? (
        <div className="glass relative z-10 rounded-[28px] px-6 py-6">
          <p className="font-semibold">Can’t reach Mercheck</p>
          <p className="mt-1 text-sm text-fg/55">Check your connection and try again.</p>
          <button
            type="button"
            onClick={start}
            className="mt-4 h-11 rounded-2xl bg-accent px-6 font-semibold text-accent-ink active:scale-95"
          >
            Try again
          </button>
        </div>
      ) : (
        <span className="relative z-10 h-8 w-8 animate-spin rounded-full border-2 border-fg/20 border-t-accent" aria-label="Loading" />
      )}
    </div>
  );
}
