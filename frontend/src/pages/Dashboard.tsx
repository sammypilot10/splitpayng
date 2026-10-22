import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Shield,
  ArrowRight,
  Mail,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth');
    }
  }, [user, isLoading, navigate]);

  const handleResendVerification = async () => {
    setResending(true);
    setResendMsg('');
    try {
      await api.post('/auth/resend-verification');
      setResendMsg('Verification email sent! Check your inbox.');
    } catch (err: any) {
      setResendMsg(err.message || 'Failed to send. Try again later.');
    } finally {
      setResending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b0c10]">
        <div className="w-12 h-12 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const isAdmin = user.role === 'ADMIN';
  const isHost = user.role === 'HOST' || isAdmin;

  const quickActions = [
    {
      title: 'Browse Pools',
      description: 'Find subscription pools to join',
      icon: <Users className="w-6 h-6" />,
      href: '/',
      color: 'bg-blue-500/20 text-blue-400',
    },
    ...(isHost ? [{
      title: 'Create Pool',
      description: 'Start a new subscription pool',
      icon: <CreditCard className="w-6 h-6" />,
      href: '/create-pool',
      color: 'bg-green-500/20 text-green-400',
    }] : []),
    {
      title: 'My Subscriptions',
      description: 'Manage your active subscriptions',
      icon: <LayoutDashboard className="w-6 h-6" />,
      href: '/my-subscriptions',
      color: 'bg-purple-500/20 text-purple-400',
    },
    ...(isAdmin ? [{
      title: 'Admin Panel',
      description: 'Manage disputes and users',
      icon: <Shield className="w-6 h-6" />,
      href: '/admin/disputes',
      color: 'bg-red-500/20 text-red-400',
    }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0b0c10] p-6">
      <div className="max-w-6xl mx-auto">
        {/* Email Verification Banner */}
        {user && !user.emailVerified && (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-amber-200 font-medium">Verify your email</p>
              <p className="text-xs text-amber-200/70 mt-1">
                You need to verify your email before creating pools or receiving payouts.
              </p>
              <button
                onClick={handleResendVerification}
                disabled={resending}
                className="mt-2 text-xs text-amber-300 hover:text-amber-200 flex items-center gap-1 disabled:opacity-50"
              >
                {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                {resending ? 'Sending...' : 'Resend verification email'}
              </button>
              {resendMsg && <p className="text-xs text-emerald-400 mt-1">{resendMsg}</p>}
            </div>
          </div>
        )}

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Welcome back, {user.fullName}</h1>
          <p className="text-slate-400">Manage your subscriptions and pools from one place.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action) => (
            <button
              key={action.title}
              onClick={() => navigate(action.href)}
              className="dark-panel border-[#26293b] p-6 hover:border-slate-600 transition-all text-left group"
            >
              <div className={`w-12 h-12 rounded-lg ${action.color} flex items-center justify-center mb-4`}>
                {action.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-indigo-400 transition-colors">
                {action.title}
              </h3>
              <p className="text-slate-400 text-sm mb-4">{action.description}</p>
              <div className="flex items-center text-indigo-400 text-sm font-medium">
                Get started <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}