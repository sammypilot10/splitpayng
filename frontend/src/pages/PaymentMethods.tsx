import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PaymentMethod, ApiResponse } from '../types';
import {
  CreditCard, Plus, ShieldCheck, CheckCircle2, Trash2,
  Loader2, AlertCircle, Star
} from 'lucide-react';

export default function PaymentMethods() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingCard, setAddingCard] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchMethods = async () => {
    try {
      const res: any = await api.get<ApiResponse<PaymentMethod[]>>('/payments/methods');
      setMethods(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMethods();
  }, []);

  const handleAddCard = async () => {
    setError('');
    setAddingCard(true);
    try {
      const res: any = await api.post('/payments/methods/initialize-add');
      if (res.success && res.data.authorizationUrl) {
        window.location.href = res.data.authorizationUrl;
      } else {
        setError(res.message || 'Failed to initialize card addition');
        setAddingCard(false);
      }
    } catch (err: any) {
      setError(err.message || 'Error initializing card verification');
      setAddingCard(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    setActionId(id);
    setError('');
    setSuccess('');
    try {
      await api.patch(`/payments/methods/${id}/default`);
      setMethods(prev => prev.map(m => ({ ...m, isDefault: m.id === id })));
      setSuccess('Default payment card updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to set default card');
    } finally {
      setActionId(null);
    }
  };

  const handleDeleteCard = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this card?')) return;
    setActionId(id);
    setError('');
    setSuccess('');
    try {
      await api.delete(`/payments/methods/${id}`);
      setMethods(prev => prev.filter(m => m.id !== id));
      setSuccess('Card removed successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to remove card');
    } finally {
      setActionId(null);
    }
  };

  const getBrandBadge = (brand?: string | null, cardType?: string) => {
    const b = (brand || cardType || '').toLowerCase();
    if (b.includes('visa')) {
      return (
        <span className="text-[11px] font-extrabold tracking-wider px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
          VISA
        </span>
      );
    }
    if (b.includes('master')) {
      return (
        <span className="text-[11px] font-extrabold tracking-wider px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
          MASTERCARD
        </span>
      );
    }
    if (b.includes('verve')) {
      return (
        <span className="text-[11px] font-extrabold tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">
          VERVE
        </span>
      );
    }
    return (
      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-500/10 text-slate-300 border border-slate-500/20 uppercase">
        {b || 'CARD'}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 px-4 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Payment Methods & Cards</h1>
          <p className="text-xs text-slate-400">
            Authorized debit cards for automatic monthly pool subscription renewals
          </p>
        </div>

        <button
          onClick={handleAddCard}
          disabled={addingCard}
          className="btn-solid-white text-xs !py-2.5 !px-4 inline-flex items-center gap-2 self-start sm:self-auto"
        >
          {addingCard ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Connecting Paystack...</span>
            </>
          ) : (
            <>
              <Plus size={14} />
              <span>Add New Card</span>
            </>
          )}
        </button>
      </div>

      {/* Security Banner */}
      <div className="p-4 rounded-2xl bg-[#11131c] border border-[#26293b] flex items-start gap-3.5">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
          <ShieldCheck size={18} />
        </div>
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-white">Bank-Grade Tokenization & Security</h4>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Your card details are processed and encrypted directly with Paystack (PCI-DSS Level 1 certified).
            SplitPay only receives a secure token to process monthly renewals when they become due.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Card List */}
      {methods.length === 0 ? (
        <div className="dark-panel p-10 text-center border-[#26293b] space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#151722] border border-[#26293b] flex items-center justify-center mx-auto text-slate-500">
            <CreditCard size={26} />
          </div>
          <div>
            <h3 className="text-base font-bold text-white mb-1">No Cards on File</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
              You haven&apos;t added any payment cards yet. To join pools and ensure continuous access without manual renewal every month, link a card.
            </p>
          </div>
          <button
            onClick={handleAddCard}
            disabled={addingCard}
            className="btn-solid-white text-xs !py-3 !px-6 inline-flex items-center gap-2"
          >
            <Plus size={14} /> Add Your First Card
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {methods.map((method) => (
            <div
              key={method.id}
              className={`p-5 rounded-2xl bg-[#11131c] border transition-all ${
                method.isDefault
                  ? 'border-indigo-500/40 shadow-[0_0_20px_rgba(99,102,241,0.08)]'
                  : 'border-[#26293b]'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#151722] border border-[#26293b] flex items-center justify-center text-slate-300">
                    <CreditCard size={22} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      {getBrandBadge(method.brand, method.cardType)}
                      <span className="text-sm font-bold text-white tracking-wider font-mono">
                        •••• •••• •••• {method.last4}
                      </span>
                      {method.isDefault && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          <Star size={10} className="fill-indigo-400" /> Default Card
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      {method.bank && <span>{method.bank}</span>}
                      {method.bank && <span>•</span>}
                      <span>Expires {method.expMonth}/{method.expYear}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#26293b]">
                  {!method.isDefault && (
                    <button
                      onClick={() => handleSetDefault(method.id)}
                      disabled={actionId === method.id}
                      className="btn-slate-outline text-xs !py-1.5 !px-3 inline-flex items-center gap-1.5"
                    >
                      {actionId === method.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Star size={12} />
                      )}
                      <span>Set as Default</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleDeleteCard(method.id)}
                    disabled={actionId === method.id}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Remove card"
                  >
                    {actionId === method.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Verification Notice */}
      <div className="p-4 rounded-xl bg-[#0b0c10] border border-[#26293b]/60 text-[11px] text-slate-500 leading-relaxed">
        <p>
          <strong className="text-slate-400">Note:</strong> Adding a card verifies it via a refundable ₦100 verification transaction through Paystack to confirm 3D-Secure bank authorization. This is automatically refunded upon verification.
        </p>
      </div>
    </div>
  );
}
