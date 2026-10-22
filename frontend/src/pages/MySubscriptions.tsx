import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import type { ApiResponse } from '../types';
import {
  Inbox, ArrowRight, Shield, Clock, CheckCircle2, AlertTriangle,
  Lock, Eye, EyeOff, Copy, Check, Send, Loader2, Upload, X, RotateCcw, CreditCard
} from 'lucide-react';

interface MembershipWithPool {
  id: string;
  status: string;
  escrowEndsAt: string | null;
  nextBillingDate: string | null;
  createdAt: string;
  pool: {
    id: string;
    name: string;
    category: string;
    poolType: string;
    encryptedCredentials: string;
    host: { fullName: string };
  };
}

interface DecryptedCreds {
  username: string;
  password: string;
}

interface Evidence {
  id: string;
  fileUrl: string;
  fileName: string;
  role: string;
  createdAt: string;
}

const API_BASE = ((import.meta as any).env?.VITE_API_URL as string) || 'http://localhost:5000/api';
const UPLOAD_BASE = API_BASE; // Evidence files served via authenticated /api/uploads route

// ─── Helpers (defined outside component to avoid recreation) ─────────────

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    IN_ESCROW: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    DISPUTED: 'bg-red-500/10 text-red-400 border-red-500/20',
    FAILED: 'bg-red-500/10 text-red-400 border-red-500/20',
    CANCELLED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  };
  return styles[status] || styles.CANCELLED;
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'ACTIVE': return <CheckCircle2 size={14} />;
    case 'IN_ESCROW': return <Clock size={14} />;
    case 'DISPUTED': return <AlertTriangle size={14} />;
    default: return <Shield size={14} />;
  }
};

const getEscrowHours = (membership: MembershipWithPool) => {
  const created = new Date(membership.createdAt).getTime();
  const ends = membership.escrowEndsAt ? new Date(membership.escrowEndsAt).getTime() : created + 48 * 60 * 60 * 1000;
  return Math.round((ends - created) / (1000 * 60 * 60));
};

const getTimeRemaining = (escrowEndsAt: string | null) => {
  if (!escrowEndsAt) return null;
  const diff = new Date(escrowEndsAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h remaining`;
  }
  return `${hours}h ${mins}m remaining`;
};

// ─── Memoized Membership Card ──────────────────────────────────────────────

interface MembershipCardProps {
  membership: MembershipWithPool;
  creds: DecryptedCreds | undefined;
  showPw: boolean | undefined;
  copied: Record<string, boolean>;
  decryptingId: string | null;
  encryptionPassword: string;
  decryptError: string;
  reportingId: string | null;
  onStartDecrypt: (id: string) => void;
  onDecrypt: (id: string) => void;
  onCancelDecrypt: () => void;
  onPasswordChange: (val: string) => void;
  onTogglePw: (id: string) => void;
  onCopy: (text: string, key: string) => void;
  onConfirm: (id: string) => void;
  onDispute: (id: string) => void;
  onReportBroken: (id: string) => void;
}

const MembershipCard = memo(function MembershipCard({
  membership: m,
  creds,
  showPw,
  copied,
  decryptingId,
  encryptionPassword,
  decryptError,
  reportingId,
  onStartDecrypt,
  onDecrypt,
  onCancelDecrypt,
  onPasswordChange,
  onTogglePw,
  onCopy,
  onConfirm,
  onDispute,
  onReportBroken,
}: MembershipCardProps) {
  const escrowHours = getEscrowHours(m);
  const isNewHostEscrow = escrowHours > 48;
  const timeLeft = getTimeRemaining(m.escrowEndsAt);
  const isDecrypting = decryptingId === m.id;

  return (
    <div className="dark-panel p-5 sm:p-6 border-[#26293b] gpu-layer">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-white">{m.pool.name}</h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${getStatusBadge(m.status)}`}>
              {getStatusIcon(m.status)} {m.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-slate-400">Host: {m.pool.host.fullName}</p>
          {m.status === 'IN_ESCROW' && timeLeft && (
            <div className={`flex items-center gap-1.5 text-xs mt-1.5 ${isNewHostEscrow ? 'text-amber-400' : 'text-emerald-400'}`}>
              <Clock size={12} />
              <span>{isNewHostEscrow ? '7-Day Escrow' : '48h Escrow'} — {timeLeft}</span>
            </div>
          )}
        </div>
        <div className="text-left sm:text-right">
          <div className="text-xs text-slate-400">Next billing</div>
          <div className="text-sm font-semibold text-white">
            {m.nextBillingDate ? new Date(m.nextBillingDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
          </div>
          {(m.status === 'ACTIVE' || m.status === 'IN_ESCROW') && (
            <Link
              to="/payment-methods"
              className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 mt-1 transition-colors"
            >
              <CreditCard size={11} /> Auto-renew card
            </Link>
          )}
        </div>
      </div>

      {m.status !== 'CANCELLED' && m.status !== 'FAILED' && (
        <div className="mb-4">
          {creds ? (
            <div className="bg-[#11131c] border border-[#26293b] rounded-xl p-4 space-y-3 gpu-layer">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Credentials</span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Lock size={10} /> Decrypted
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-[#0b0c10] rounded-lg px-3 py-2">
                  <div>
                    <div className="text-[10px] text-slate-500">Username / Email</div>
                    <div className="text-sm text-white font-mono">{creds.username}</div>
                  </div>
                  <button onClick={() => onCopy(creds.username, `${m.id}-user`)} className="text-slate-400 hover:text-white transition-colors">
                    {copied[`${m.id}-user`] ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="flex items-center justify-between bg-[#0b0c10] rounded-lg px-3 py-2">
                  <div>
                    <div className="text-[10px] text-slate-500">Password</div>
                    <div className="text-sm text-white font-mono">{showPw ? creds.password : '••••••••'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onTogglePw(m.id)} className="text-slate-400 hover:text-white transition-colors">
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={() => onCopy(creds.password, `${m.id}-pass`)} className="text-slate-400 hover:text-white transition-colors">
                      {copied[`${m.id}-pass`] ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : isDecrypting ? (
            <div className="bg-[#11131c] border border-[#26293b] rounded-xl p-4 space-y-3 gpu-layer">
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="password"
                  value={encryptionPassword}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  className="w-full bg-[#0b0c10] border border-[#26293b] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
                  placeholder="Enter encryption password"
                  onKeyDown={(e) => e.key === 'Enter' && onDecrypt(m.id)}
                />
              </div>
              {decryptError && <p className="text-xs text-red-400">{decryptError}</p>}
              <div className="flex gap-2">
                <button onClick={() => onDecrypt(m.id)} className="btn-solid-white text-xs !py-2 flex-1">
                  Decrypt
                </button>
                <button onClick={onCancelDecrypt} className="btn-slate-outline text-xs !py-2 !px-3">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onStartDecrypt(m.id)}
              className="w-full btn-slate-outline text-xs !py-2.5 flex items-center justify-center gap-1.5"
            >
              <Lock size={14} /> Decrypt Credentials
            </button>
          )}
        </div>
      )}

      {m.status === 'IN_ESCROW' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => onConfirm(m.id)} className="btn-solid-white text-xs !py-2.5 flex-1 flex items-center justify-center gap-1.5">
            <CheckCircle2 size={14} /> Confirm Access
          </button>
          <button onClick={() => onDispute(m.id)} className="btn-slate-outline text-xs !py-2.5 flex items-center justify-center gap-1.5 text-red-400 border-red-500/20 hover:bg-red-500/10">
            <AlertTriangle size={14} /> Raise Dispute
          </button>
        </div>
      )}

      {m.status === 'ACTIVE' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => onReportBroken(m.id)}
            disabled={reportingId === m.id}
            className="btn-slate-outline text-xs !py-2.5 flex items-center justify-center gap-1.5 text-amber-400 border-amber-500/20 hover:bg-amber-500/10 disabled:opacity-50"
          >
            {reportingId === m.id ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            Report Broken Credentials
          </button>
        </div>
      )}

      {m.status === 'DISPUTED' && (
        <div className="mt-4 p-4 rounded-xl bg-red-500/5 border border-red-500/10">
          <div className="flex items-center gap-2 text-red-400 text-xs mb-3">
            <AlertTriangle size={14} /> Dispute in progress — admin is reviewing
          </div>
          <MemberDisputeChat membershipId={m.id} />
        </div>
      )}
    </div>
  );
});

// ─── Memoized Dispute Chat ─────────────────────────────────────────────────

const MemberDisputeChat = memo(function MemberDisputeChat({ membershipId }: { membershipId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(() => {
    api.get(`/memberships/${membershipId}/dispute/messages`)
      .then((res: any) => setMessages(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [membershipId]);

  const fetchEvidences = useCallback(() => {
    api.get(`/memberships/${membershipId}/dispute/evidence`)
      .then((res: any) => setEvidences(res.data || []))
      .catch(console.error);
  }, [membershipId]);

  useEffect(() => {
    fetchMessages();
    fetchEvidences();
    // FIX: Reduced from 5000ms to 10000ms to lower render pressure
    const interval = setInterval(() => {
      fetchMessages();
      fetchEvidences();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchMessages, fetchEvidences]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!newMsg.trim()) return;
    setSending(true);
    try {
      const res: any = await api.post(`/memberships/${membershipId}/dispute/messages`, { message: newMsg });
      setMessages(prev => [...prev, res.data]);
      setNewMsg('');
    } catch {
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  }, [newMsg, membershipId]);

  const uploadEvidence = useCallback(async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('evidence', file);
    try {
      const res = await fetch(`${API_BASE}/memberships/${membershipId}/dispute/evidence`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setEvidences(prev => [...prev, data.data]);
      }
    } catch {
      alert('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [membershipId]);

  const getRoleBadge = (role: string) => {
    const styles: Record<string, string> = {
      ADMIN: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      MEMBER: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      HOST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };
    return styles[role] || styles.ADMIN;
  };

  return (
    <div className="space-y-3">
      {evidences.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Evidence</h4>
          <div className="flex flex-wrap gap-2 mb-2">
            {evidences.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setPreviewImage(`${UPLOAD_BASE}${ev.fileUrl}`)}
                className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#26293b] hover:border-indigo-500/50 transition-colors gpu-layer"
              >
                <img src={`${UPLOAD_BASE}${ev.fileUrl}`} alt={ev.fileName} className="w-full h-full object-cover" loading="lazy" />
                <span className={`absolute top-0.5 left-0.5 text-[8px] font-bold px-1 py-0.5 rounded ${ev.role === 'HOST' ? 'bg-emerald-500/80 text-white' : ev.role === 'ADMIN' ? 'bg-indigo-500/80 text-white' : 'bg-amber-500/80 text-white'}`}>
                  {ev.role}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Dispute Chat</h4>
        <div ref={scrollRef} className="bg-[#0b0c10] border border-[#26293b] rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto gpu-layer">
          {loading ? (
            <p className="text-xs text-slate-500 text-center py-2">Loading messages...</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">No messages yet. State your case here.</p>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 mt-0.5 ${getRoleBadge(msg.senderRole)}`}>
                  {msg.senderRole}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-300 leading-relaxed">{msg.message}</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    {new Date(msg.createdAt).toLocaleString('en-NG')}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="file"
          ref={fileRef}
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && uploadEvidence(e.target.files[0])}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-slate-outline text-xs !py-2 !px-2.5 disabled:opacity-50"
          title="Upload proof"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        </button>
        <input
          type="text"
          value={newMsg}
          onChange={(e) => setNewMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Reply to dispute..."
          className="flex-1 bg-[#151722] border border-[#26293b] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50"
        />
        <button
          onClick={sendMessage}
          disabled={sending || !newMsg.trim()}
          className="btn-solid-white text-xs !py-2 !px-3 disabled:opacity-50 flex items-center gap-1.5"
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-3xl max-h-[85vh]">
            <img src={previewImage} alt="Evidence preview" className="max-w-full max-h-[85vh] rounded-xl" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-[#1a1c2e] border border-[#26293b] flex items-center justify-center text-slate-400 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Main Component ────────────────────────────────────────────────────────

export default function MySubscriptions() {
  const auth = useAuth();
  const user = auth.user;
  const authLoading = (auth as any).isLoading ?? false;

  const [memberships, setMemberships] = useState<MembershipWithPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decryptingId, setDecryptingId] = useState<string | null>(null);
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [decryptedCreds, setDecryptedCreds] = useState<Record<string, DecryptedCreds>>({});
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [decryptError, setDecryptError] = useState('');
  const [reportingId, setReportingId] = useState<string | null>(null);

  const fetchMemberships = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiResponse<MembershipWithPool[]>>('/memberships/my');
      setMemberships(res.data || []);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message;
      if (status === 401) {
        setError('Session expired. Please log out and log in again.');
      } else {
        setError(msg || 'Failed to load subscriptions. Tap retry.');
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      setLoading(false);
      setError('You need to be logged in to view subscriptions.');
      return;
    }
    fetchMemberships();
  }, [user?.id, authLoading, fetchMemberships]);

  const handleConfirm = useCallback(async (id: string) => {
    try {
      await api.post(`/memberships/${id}/confirm`, {});
      setMemberships(prev => prev.map(m => m.id === id ? { ...m, status: 'ACTIVE' } : m));
    } catch (err: any) {
      alert(err.message);
    }
  }, []);

  const handleDispute = useCallback(async (id: string) => {
    const reason = prompt('Why are you raising a dispute? (e.g. credentials not working)');
    if (!reason) return;
    try {
      await api.post(`/memberships/${id}/dispute`, { reason });
      setMemberships(prev => prev.map(m => m.id === id ? { ...m, status: 'DISPUTED' } : m));
    } catch (err: any) {
      alert(err.message);
    }
  }, []);

  const handleReportBroken = useCallback(async (id: string) => {
    if (!confirm('Are you sure? This will open a dispute and pause your subscription. You can only do this within 7 days of joining.')) return;
    setReportingId(id);
    try {
      await api.post(`/memberships/${id}/report-broken`, {});
      setMemberships(prev => prev.map(m => m.id === id ? { ...m, status: 'DISPUTED' } : m));
    } catch (err: any) {
      alert(err.message || 'Failed to report. You may be outside the 7-day window.');
    } finally {
      setReportingId(null);
    }
  }, []);

  const handleDecrypt = useCallback(async (membershipId: string) => {
    setDecryptError('');
    if (!encryptionPassword.trim()) {
      setDecryptError('Please enter the encryption password');
      return;
    }
    try {
      const res = await api.post<ApiResponse<DecryptedCreds>>(`/memberships/${membershipId}/decrypt`, {
        encryptionPassword,
      });
      setDecryptedCreds(prev => ({ ...prev, [membershipId]: res.data }));
      setDecryptingId(null);
      setEncryptionPassword('');
    } catch (err: any) {
      setDecryptError(err.message || 'Failed to decrypt credentials');
    }
  }, [encryptionPassword]);

  const handleCancelDecrypt = useCallback(() => {
    setDecryptingId(null);
    setDecryptError('');
    setEncryptionPassword('');
  }, []);

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [key]: false })), 2000);
  }, []);

  const handleTogglePw = useCallback((id: string) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <div className="dark-panel p-8 border-[#26293b]">
          <AlertTriangle size={36} className="mx-auto text-red-400 mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-xs text-slate-400 mb-6">{error}</p>
          <button onClick={fetchMemberships} className="btn-solid-white text-xs inline-flex items-center gap-1.5">
            <RotateCcw size={14} /> Try Again
          </button>
        </div>
      </div>
    );
  }

  if (memberships.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <div className="dark-panel p-8 sm:p-10 border-[#26293b]">
          <div className="w-16 h-16 rounded-2xl bg-[#11131c] border border-[#26293b] flex items-center justify-center mx-auto mb-4 text-slate-400">
            <Inbox size={32} />
          </div>
          <h2 className="text-xl font-bold text-white mb-1.5">No Active Subscriptions</h2>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            You haven&apos;t joined any subscription pools yet. Browse the marketplace to find one.
          </p>
          <Link to="/marketplace" className="btn-solid-white text-xs !py-3 !px-6 inline-flex items-center gap-1.5">
            Browse Pools <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 sm:px-0">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">My Subscriptions</h1>
        <p className="text-xs text-slate-400">Manage your active subscription pools</p>
      </div>

      <div className="space-y-4">
        {memberships.map((m) => (
          <MembershipCard
            key={m.id}
            membership={m}
            creds={decryptedCreds[m.id]}
            showPw={showPassword[m.id]}
            copied={copied}
            decryptingId={decryptingId}
            encryptionPassword={encryptionPassword}
            decryptError={decryptError}
            reportingId={reportingId}
            onStartDecrypt={(id) => setDecryptingId(id)}
            onDecrypt={handleDecrypt}
            onCancelDecrypt={handleCancelDecrypt}
            onPasswordChange={setEncryptionPassword}
            onTogglePw={handleTogglePw}
            onCopy={copyToClipboard}
            onConfirm={handleConfirm}
            onDispute={handleDispute}
            onReportBroken={handleReportBroken}
          />
        ))}
      </div>
    </div>
  );
}