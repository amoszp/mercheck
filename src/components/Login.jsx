import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';

const ERRORS = {
  0: 'No connection. Try again in a moment.',
  401: 'Wrong username or password.',
  409: 'That username is taken.',
  429: 'Too many attempts. Wait a few minutes.',
};

/** Sign in, or create an account (it works straight away). */
export default function Login({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', username: '', password: '', password2: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const switchMode = () => {
    setMode(signup ? 'login' : 'signup');
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (signup && form.password !== form.password2) {
      setError('The passwords don’t match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { user } = signup
        ? await api.post('/api/auth/signup', {
            displayName: form.name.trim(),
            username: form.username.trim(),
            password: form.password,
          })
        : await api.post('/api/auth/login', { username: form.username.trim(), password: form.password });
      await onSignedIn(user);
    } catch (err) {
      setError(ERRORS[err.status] ?? (signup ? err.message : ERRORS[401]));
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-dvh items-center justify-center overflow-y-auto px-5 py-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        className="glass relative z-10 w-full max-w-sm rounded-[28px] p-6"
      >
        <img src="/pwa-192x192.png" alt="" className="mx-auto h-16 w-16 rounded-2xl" />
        <h1 className="mt-4 text-center text-2xl font-semibold tracking-tight">
          {signup ? 'Create account' : 'Mercheck'}
        </h1>
        <p className="mt-1 text-center text-sm text-fg/55">
          {signup ? 'Your lists, on every device.' : 'Sign in to see your lists.'}
        </p>

        <div className="mt-6 space-y-3">
          {signup && (
            <input
              {...field('name')} name="name"
              className="field px-4 py-3"
              placeholder="Name"
              aria-label="Name"
              autoComplete="name"
              maxLength={40}
              required
            />
          )}
          <input
            {...field('username')} name="username"
            className="field px-4 py-3"
            placeholder="Username"
            aria-label="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            required
          />
          <input
            {...field('password')} name="password"
            type="password"
            className="field px-4 py-3"
            placeholder="Password"
            aria-label="Password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? 4 : undefined}
            required
          />
          {signup && (
            <input
              {...field('password2')} name="password2"
              type="password"
              className="field px-4 py-3"
              placeholder="Repeat password"
              aria-label="Repeat password"
              autoComplete="new-password"
              minLength={4}
              required
            />
          )}
        </div>

        {signup && (
          <p className="mt-2 px-1 text-xs text-fg/45">Username: lowercase letters, numbers, dot, dash or underscore.</p>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 h-12 w-full rounded-2xl bg-accent font-semibold text-accent-ink shadow-[0_0_18px_rgb(var(--accent)/0.35)] transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={switchMode}
          className="mt-3 w-full py-2 text-sm text-fg/60 transition hover:text-fg"
        >
          {signup ? 'I already have an account' : 'No account? Create one'}
        </button>
      </motion.form>
    </div>
  );
}
