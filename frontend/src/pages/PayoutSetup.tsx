import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { CheckCircle2, Loader2, Landmark, ArrowRight, CreditCard, User, Shield, Clock, XCircle, ArrowUpRight, RefreshCw } from 'lucide-react';

interface Bank {
  code: string;
  name: string;
  slug: string;
}

interface PayoutRecord {
  id: string;
  amount: number;
  status: string;
  transferCode: string | null;
  failureReason: string | null;
  payoutDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  poolName: string;
  memberName: string;
  reference: string;
}

export default function PayoutSetup() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savedAccount, setSavedAccount] = useState<any>(null);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(false);

  const [form, setForm] = useState({
    bankCode: '',
    bankName: '',
    accountNumber: '',
    accountName: '',
  });

  const { user: _user } = useAuth();

  const fetchPayouts = () => {
    setPayoutsLoading(true);
    api.get('/banks/payouts')
      .then((res: any) => setPayouts(res.data || []))
      .catch(console.error)
      .finally(() => setPayoutsLoading(false));
  };

  useEffect(() => {
    api.get('/banks/list')
      .then((res: any) => setBanks(res.data || []))
      .catch(() => setError('Failed to load banks'))
      .finally(() => setLoading(false));

    api.get('/banks/my')
      .then((res: any) => {
        if (res.data) setSavedAccount(res.data);
      })
      .catch(console.error);

    fetchPayouts();
  }, []);

  const handleResolve = async () => {
    setError('');
    setSuccess('');
    if (!form.bankCode || !form.accountNumber || form.accountNumber.length < 10) {
      setError('Select a bank and enter a valid 10-digit account number');
      return;
    }
    setResolving(true);
    try {
      const res = await api.post('/banks/resolve', {
        bankCode: form.bankCode,
        accountNumber: form.accountNumber,
      });
      setForm(prev => ({ ...prev, accountName: res.data.accountName }));
      setSuccess(`Account verified: ${res.data.accountName}`);
    } catch (err: any) {
      setError(err.message || 'Could not verify account');
    } finally {
      setResolving(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    if (!form.bankCode || !form.bankName || !form.accountNumber || !form.accountName) {
      setError('Please verify your account first');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/banks/setup', form);
      setSavedAccount(res.data);
      setSuccess('Bank account saved successfully! You can now receive payouts.');
      setForm({ bankCode: '', bankName: '', accountNumber: '', accountName: '' });
    } catch (err: any) {
      setError(err.message || 'Failed to save account');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="text-indigo-400 animate-spin" />
      </div>
    );
  }

  const statusConfig: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
    COMPLETED: { icon: <CheckCircle2 size={12} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Completed' },
    SCHEDULED: { icon: <Clock size={12} />, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', label: 'Scheduled' },
    PROCESSING: { icon: <ArrowUpRight size={12} />, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Processing' },
    PENDING: { icon: <Clock size={12} />, color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20', label: 'Pending' },
    FAILED: { icon: <XCircle size={12} />, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: 'Failed' },
  };

  const renderPayoutHistory = () => (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Payout History</h3>
        <button
          onClick={fetchPayouts}
          disabled={payoutsLoading}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
        >
          <RefreshCw size={12} className={payoutsLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {payoutsLoading && payouts.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={24} className="text-indigo-400 animate-spin" />
        </div>
      ) : payouts.length === 0 ? (
        <div className="dark-panel p-8 text-center border-[#26293b]">
          <p className="text-sm text-slate-500">No payouts yet. Earnings will appear here once members join your pools.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {payouts.map((p) => {
            const cfg = statusConfig[p.status] || statusConfig.PENDING;
            return (
              <div key={p.id} className="dark-panel p-4 border-[#26293b]">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-white">₦{p.amount.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{p.poolName}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border ${cfg.bg} ${cfg.color}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>From: {p.memberName}</span>
                  <span>{new Date(p.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                {p.failureReason && (
                  <p className="text-[10px] text-red-400 mt-2 flex items-center gap-1">
                    <XCircle size={10} /> {p.failureReason}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (savedAccount) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="dark-panel p-8 text-center border-[#26293b]">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Payout Account Active</h2>
          <p className="text-xs text-slate-400 mb-6">Your earnings will be transferred to this account.</p>

          <div className="space-y-3 text-left p-4 rounded-xl bg-[#11131c] border border-[#26293b]">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Bank</span>
              <span className="text-sm font-medium text-white">{savedAccount.bankName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Account Number</span>
              <span className="text-sm font-medium text-white font-mono">{savedAccount.accountNumber}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Account Name</span>
              <span className="text-sm font-medium text-white">{savedAccount.accountName}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-[#26293b]">
              <span className="text-xs text-slate-500">Status</span>
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={12} /> Verified
              </span>
            </div>
          </div>
        </div>

        {renderPayoutHistory()}
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Payout Setup</h1>
        <p className="text-xs text-slate-400">Add your Nigerian bank account to receive earnings</p>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          {success}
        </div>
      )}

      <div className="dark-panel p-6 sm:p-8 border-[#26293b] space-y-5">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-[#1b1e2b] border border-[#26293b] flex items-center justify-center text-slate-300">
            <Landmark size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Bank Account Details</h3>
            <p className="text-[11px] text-slate-500">We use Paystack to verify and transfer funds</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">Select Bank</label>
          <div className="relative">
            <Landmark className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <select
              value={form.bankCode}
              onChange={(e) => {
                const bank = banks.find(b => b.code === e.target.value);
                setForm({ ...form, bankCode: e.target.value, bankName: bank?.name || '' });
              }}
              className="w-full bg-[#0b0c10] border border-[#26293b] rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-slate-400 appearance-none"
            >
              <option value="">Choose your bank...</option>
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>{bank.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">Account Number</label>
          <div className="relative">
            <CreditCard className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={form.accountNumber}
              onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              className="w-full bg-[#0b0c10] border border-[#26293b] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
              placeholder="10-digit account number"
              maxLength={10}
            />
          </div>
        </div>

        <button
          onClick={handleResolve}
          disabled={resolving || !form.bankCode || form.accountNumber.length < 10}
          className="w-full btn-slate-outline text-sm !py-3 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {resolving ? <Loader2 size={16} className="animate-spin" /> : <User size={16} />}
          {resolving ? 'Verifying...' : 'Verify Account Name'}
        </button>

        {form.accountName && (
          <div className="p-4 rounded-xl bg-[#11131c] border border-[#26293b]">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Account Name</p>
            <p className="text-sm font-bold text-white flex items-center gap-2">
              <Shield size={14} className="text-emerald-400" />
              {form.accountName}
            </p>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !form.accountName}
          className="w-full btn-solid-white text-sm !py-3 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          {saving ? 'Saving...' : 'Save Payout Account'}
        </button>
      </div>
    </div>
  );
}