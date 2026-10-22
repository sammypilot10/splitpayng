import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [isMagicLink, setIsMagicLink] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', fullName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isForgotPassword) {
        await api.post('/auth/forgot-password', { email: form.email });
        setResetSent(true);
      } else if (isMagicLink) {
        await api.post('/auth/magic-link', { email: form.email });
        setMagicSent(true);
      } else {
        const endpoint = isLogin ? '/auth/login' : '/auth/register';
        const res: any = await api.post(endpoint, form);
        login(res.data.user);
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (mode: 'login' | 'register' | 'magic' | 'forgot') => {
    setError('');
    setMagicSent(false);
    setResetSent(false);
    if (mode === 'login') {
      setIsLogin(true);
      setIsMagicLink(false);
      setIsForgotPassword(false);
    } else if (mode === 'register') {
      setIsLogin(false);
      setIsMagicLink(false);
      setIsForgotPassword(false);
    } else if (mode === 'magic') {
      setIsMagicLink(!isMagicLink);
      setIsForgotPassword(false);
    } else if (mode === 'forgot') {
      setIsForgotPassword(true);
      setIsMagicLink(false);
      setIsLogin(true);
    }
  };

  if (resetSent) {
    return (
      <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
        <div className="w-full max-w-md dark-panel border-[#26293b] p-8 text-center">
          <Mail className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Check your email!</h3>
          <p className="text-sm text-slate-400">
            If an account exists for <strong>{form.email}</strong>, we&apos;ve sent a password reset link.
          </p>
          <button
            onClick={() => switchMode('login')}
            className="mt-6 text-indigo-400 hover:text-indigo-300 text-xs"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (magicSent) {
    return (
      <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
        <div className="w-full max-w-md dark-panel border-[#26293b] p-8 text-center">
          <Mail className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Check your email!</h3>
          <p className="text-sm text-slate-400">
            We&apos;ve sent a magic link to <strong>{form.email}</strong>. Click the link to log in.
          </p>
          <button
            onClick={() => switchMode('login')}
            className="mt-6 text-indigo-400 hover:text-indigo-300 text-xs"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
      <div className="w-full max-w-md dark-panel border-[#26293b] p-8">
        <h1 className="text-2xl font-bold text-white mb-2 text-center">
          {isForgotPassword
            ? 'Reset Password'
            : isMagicLink
              ? 'Magic Link'
              : isLogin
                ? 'Welcome Back'
                : 'Get Started'}
        </h1>
        <p className="text-sm text-slate-400 text-center mb-8">
          {isForgotPassword
            ? 'Enter your email to receive a reset link'
            : isMagicLink
              ? 'Enter your email to receive a login link'
              : isLogin
                ? 'Sign in to your SplitPayNG account'
                : 'Create your account to start sharing subscriptions'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && !isMagicLink && !isForgotPassword && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  className="w-full bg-[#0b0c10] border border-[#26293b] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
                  placeholder="John Doe"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                className="w-full bg-[#0b0c10] border border-[#26293b] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>

          {!isMagicLink && !isForgotPassword && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  required
                  className="w-full bg-[#0b0c10] border border-[#26293b] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </div>
          )}

          {isLogin && !isForgotPassword && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Forgot password?
              </button>
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-solid-white text-sm py-3 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {loading
              ? 'Please wait...'
              : isForgotPassword
                ? 'Send Reset Link'
                : isMagicLink
                  ? 'Send Magic Link'
                  : isLogin
                    ? 'Sign In'
                    : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          {!isForgotPassword && (
            <>
              <button
                onClick={() => switchMode(isLogin ? 'register' : 'login')}
                className="text-indigo-400 hover:text-indigo-300 text-xs block w-full"
              >
                {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
              <button
                onClick={() => switchMode('magic')}
                className="text-slate-500 hover:text-slate-300 text-xs block w-full"
              >
                {isMagicLink ? 'Use password instead' : 'Use magic link instead'}
              </button>
            </>
          )}
          {isForgotPassword && (
            <button
              onClick={() => switchMode('login')}
              className="text-indigo-400 hover:text-indigo-300 text-xs block w-full"
            >
              Remember your password? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}