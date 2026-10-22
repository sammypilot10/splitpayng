import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { encryptCredentials } from '../utils/encryption';
import type { ApiResponse } from '../types';
import {
  Users, ArrowRight, Send, Lock, CheckCircle2, Clock, AlertTriangle,
  Mail, X, MessageCircle, Loader2, Upload, Image,
  Trophy, Star, Key, Eye, EyeOff, ShieldCheck, Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface HostedPool {
  id: string;
  name: string;
  category: string;
  poolType: string;
  totalSeats: number;
  pricePerSeat: number;
  status: string;
  seatsTaken: number;
  seatsAvailable: number;
  memberships: {
    id: string;
    userId: string;
    status: string;
    escrowEndsAt: string | null;
    nextBillingDate: string | null;
    createdAt: string;
    user: { id: string; fullName: string; email: string };
  }[];
}

interface Evidence {
  id: string;
  fileUrl: string;
  fileName: string;
  role: string;
  createdAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const UPLOAD_BASE = API_BASE; // Evidence files served via authenticated /api/uploads route

export default function HostDashboard() {
  const [pools, setPools] = useState<HostedPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [shareSuccess, setShareSuccess] = useState('');
  const [shareError, setShareError] = useState('');
  const { user } = useAuth();

  // Credential rotation modal state
  const [updatingPool, setUpdatingPool] = useState<HostedPool | null>(null);
  const [credsForm, setCredsForm] = useState({
    username: '',
    password: '',
    phraseKey: '',
    sendEmail: true,
  });
  const [showCredsPw, setShowCredsPw] = useState(false);
  const [showPhraseKey, setShowPhraseKey] = useState(false);
  const [updatingCreds, setUpdatingCreds] = useState(false);
  const [credsError, setCredsError] = useState('');
  const [credsSuccess, setCredsSuccess] = useState('');

  useEffect(() => {
    if (!user) return;
    api.get<ApiResponse<HostedPool[]>>('/memberships/host')
      .then((res: any) => setPools(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user]);

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updatingPool) return;
    setCredsError('');
    setCredsSuccess('');

    if (!credsForm.username.trim()) {
      setCredsError('Please enter the service account username/email');
      return;
    }
    if (!credsForm.password) {
      setCredsError('Please enter the new service account password');
      return;
    }
    if (!credsForm.phraseKey.trim()) {
      setCredsError('Please enter a secret phrase key for encryption');
      return;
    }

    setUpdatingCreds(true);
    try {
      const encryptedCredentials = encryptCredentials(
        credsForm.username.trim(),
        credsForm.password,
        credsForm.phraseKey.trim()
      );

      const res: any = await api.patch(`/pools/${updatingPool.id}/credentials`, {
        encryptedCredentials,
        encryptionPassword: credsForm.sendEmail ? credsForm.phraseKey.trim() : undefined,
      });

      setCredsSuccess(res.message || 'Credentials updated successfully and active members notified!');
      setTimeout(() => {
        setUpdatingPool(null);
        setCredsForm({ username: '', password: '', phraseKey: '', sendEmail: true });
        setCredsSuccess('');
      }, 2500);
    } catch (err: any) {
      setCredsError(err.message || 'Failed to update pool credentials');
    } finally {
      setUpdatingCreds(false);
    }
  };

  const handleSharePassword = async (membershipId: string) => {
    setShareError('');
    setShareSuccess('');
    if (!encryptionPassword.trim()) {
      setShareError('Please enter the encryption password');
      return;
    }
    try {
      const res = await api.post(`/memberships/${membershipId}/share-password`, {
        encryptionPassword,
      });
      setShareSuccess(res.message || 'Password sent successfully');
      setEncryptionPassword('');
      setTimeout(() => {
        setSharingId(null);
        setShareSuccess('');
      }, 3000);
    } catch (err: any) {
      setShareError(err.message || 'Failed to send password');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      ACTIVE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      IN_ESCROW: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      DISPUTED: 'bg-red-500/10 text-red-400 border-red-500/20',
      FAILED: 'bg-red-500/10 text-red-400 border-red-500/20',
      CANCELLED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
      PENDING: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    return styles[status] || styles.PENDING;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ACTIVE': return <CheckCircle2 size={12} />;
      case 'IN_ESCROW': return <Clock size={12} />;
      case 'DISPUTED': return <AlertTriangle size={12} />;
      default: return <Users size={12} />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (pools.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <div className="dark-panel p-8 sm:p-10 border-[#26293b]">
          <div className="w-16 h-16 rounded-2xl bg-[#11131c] border border-[#26293b] flex items-center justify-center mx-auto mb-4 text-slate-400">
            <Users size={32} />
          </div>
          <h2 className="text-xl font-bold text-white mb-1.5">No Hosted Pools Yet</h2>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            You haven&apos;t created any subscription pools. Host one to start earning monthly income.
          </p>
          <Link to="/create-pool" className="btn-solid-white text-xs !py-3 !px-6 inline-flex items-center gap-1.5">
            Host Your First Pool <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 px-4 sm:px-0">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Host Dashboard</h1>
        <p className="text-xs text-slate-400">Manage your pools and members</p>
      </div>

      {/* HOST REPUTATION PANEL */}
      {user && (
        <div className="dark-panel border-[#26293b] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Host Reputation
            </h2>
            <div className="text-2xl font-bold text-white">
              {user.reputationScore}<span className="text-sm text-slate-500 font-normal">/100</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#0b0c10] rounded-lg p-3">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Star className="w-3.5 h-3.5" /> Score
              </div>
              <div className="text-lg font-semibold text-white">{user.reputationScore}</div>
            </div>
            <div className="bg-[#0b0c10] rounded-lg p-3">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Trophy className="w-3.5 h-3.5" /> Successful Pools
              </div>
              <div className="text-lg font-semibold text-white">{user.successfulPools}</div>
            </div>
            <div className="bg-[#0b0c10] rounded-lg p-3">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Users className="w-3.5 h-3.5" /> Members Served
              </div>
              <div className="text-lg font-semibold text-white">{user.totalMembersServed}</div>
            </div>
            <div className="bg-[#0b0c10] rounded-lg p-3">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Disputes
              </div>
              <div className={`text-lg font-semibold ${user.totalDisputes > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {user.totalDisputes}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="w-full bg-[#0b0c10] rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${user.reputationScore >= 76 ? 'bg-amber-400' :
                  user.reputationScore >= 51 ? 'bg-emerald-400' :
                    user.reputationScore >= 26 ? 'bg-blue-400' : 'bg-slate-400'
                  }`}
                style={{ width: `${user.reputationScore}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>New</span>
              <span>Rising</span>
              <span>Trusted</span>
              <span>Top Rated</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="dark-panel p-4 sm:p-5 border-[#26293b]">
          <div className="text-xl sm:text-2xl font-extrabold text-white">{pools.length}</div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5">Total Pools</div>
        </div>
        <div className="dark-panel p-4 sm:p-5 border-[#26293b]">
          <div className="text-xl sm:text-2xl font-extrabold text-white">
            {pools.reduce((a, p) => a + p.seatsTaken, 0)}
          </div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5">Active Members</div>
        </div>
        <div className="dark-panel p-4 sm:p-5 border-[#26293b]">
          <div className="text-xl sm:text-2xl font-extrabold text-emerald-400">
            ₦{pools.reduce((a, p) => a + (p.seatsTaken * p.pricePerSeat), 0).toLocaleString()}
          </div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5">Monthly Revenue</div>
        </div>
        <div className="dark-panel p-4 sm:p-5 border-[#26293b]">
          <div className="text-xl sm:text-2xl font-extrabold text-white">
            {pools.reduce((a, p) => a + p.seatsAvailable, 0)}
          </div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5">Available Seats</div>
        </div>
      </div>

      {pools.map((pool) => (
        <div key={pool.id} className="dark-panel p-4 sm:p-6 border-[#26293b]">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4 sm:mb-6">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">{pool.name}</h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
                <span className="text-xs text-slate-400 capitalize">{pool.category}</span>
                <span className="text-xs text-slate-600 hidden sm:inline">•</span>
                <span className={`text-[10px] sm:text-[11px] px-2 py-0.5 rounded-md font-medium border ${pool.poolType === 'PUBLIC' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                  {pool.poolType}
                </span>
                <span className="text-xs text-slate-600 hidden sm:inline">•</span>
                <span className="text-xs text-slate-400">₦{pool.pricePerSeat.toLocaleString()}/mo</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <button
                onClick={() => {
                  setUpdatingPool(pool);
                  setCredsForm({ username: '', password: '', phraseKey: '', sendEmail: true });
                  setCredsError('');
                  setCredsSuccess('');
                }}
                className="btn-slate-outline text-xs !py-1.5 !px-3 inline-flex items-center gap-1.5 hover:border-amber-500/40 hover:text-amber-300 transition-colors"
                title="Rotate credentials (e.g. for new month/billing cycle)"
              >
                <Key size={13} className="text-amber-400" />
                <span>Update Credentials</span>
              </button>
              <div className="text-left sm:text-right">
                <div className="text-sm font-bold text-white">{pool.seatsTaken} / {pool.totalSeats}</div>
                <div className="text-[10px] text-slate-500">Seats Filled</div>
              </div>
            </div>
          </div>

          {pool.memberships.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No members yet. Share your pool link to get subscribers.</p>
          ) : (
            <div className="space-y-3">
              <div className="hidden lg:grid grid-cols-12 gap-4 text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2">
                <div className="col-span-3">Member</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-3">Joined</div>
                <div className="col-span-2">Next Bill</div>
                <div className="col-span-2 text-right">Action</div>
              </div>

              {pool.memberships.map((m) => (
                <div key={m.id} className="space-y-3">
                  <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-4 lg:items-center p-3 sm:p-4 rounded-xl bg-[#11131c] border border-[#26293b] space-y-2 lg:space-y-0">
                    <div className="lg:col-span-3 flex items-center justify-between lg:block">
                      <div>
                        <div className="text-sm font-medium text-white">{m.user.fullName}</div>
                        <div className="text-[11px] text-slate-500">{m.user.email}</div>
                      </div>
                      <span className={`lg:hidden inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${getStatusBadge(m.status)}`}>
                        {getStatusIcon(m.status)} {m.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="hidden lg:col-span-2 lg:block">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${getStatusBadge(m.status)}`}>
                        {getStatusIcon(m.status)} {m.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="lg:col-span-3 flex items-center justify-between lg:block">
                      <span className="text-xs text-slate-400 lg:hidden">Joined:</span>
                      <span className="text-xs text-slate-400">
                        {new Date(m.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>

                    <div className="lg:col-span-2 flex items-center justify-between lg:block">
                      <span className="text-xs text-slate-400 lg:hidden">Next Bill:</span>
                      <span className="text-xs text-slate-400">
                        {m.nextBillingDate ? new Date(m.nextBillingDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '—'}
                      </span>
                    </div>

                    <div className="lg:col-span-2 lg:text-right pt-1 lg:pt-0 border-t lg:border-t-0 border-[#26293b]">
                      {sharingId === m.id ? (
                        <div className="space-y-2 w-full">
                          <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                            <input
                              type="password"
                              value={encryptionPassword}
                              onChange={(e) => setEncryptionPassword(e.target.value)}
                              className="w-full bg-[#0b0c10] border border-[#26293b] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
                              placeholder="Encryption password"
                            />
                          </div>
                          {shareError && <p className="text-xs text-red-400">{shareError}</p>}
                          {shareSuccess && <p className="text-xs text-emerald-400">{shareSuccess}</p>}
                          <div className="flex gap-2">
                            <button onClick={() => handleSharePassword(m.id)} className="btn-solid-white text-xs !py-2 !px-3 flex-1">
                              <Send size={12} className="inline mr-1" /> Send
                            </button>
                            <button
                              onClick={() => { setSharingId(null); setShareError(''); setShareSuccess(''); setEncryptionPassword(''); }}
                              className="btn-slate-outline text-xs !py-2 !px-3"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSharingId(m.id)}
                          className="btn-slate-outline text-xs !py-2 !px-3 w-full sm:w-auto inline-flex items-center justify-center gap-1.5"
                        >
                          <Mail size={12} /> Share Password
                        </button>
                      )}
                    </div>
                  </div>

                  {m.status === 'DISPUTED' && (
                    <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/10 ml-0 lg:ml-4">
                      <div className="flex items-center gap-2 text-red-400 text-xs mb-3">
                        <AlertTriangle size={14} /> Member raised a dispute on this subscription
                      </div>
                      <HostDisputeChat membershipId={m.id} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* UPDATE / ROTATE CREDENTIALS MODAL */}
      {updatingPool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="dark-panel border-[#26293b] w-full max-w-lg p-6 relative rounded-2xl shadow-2xl bg-[#0e1017]">
            <button
              onClick={() => {
                if (!updatingCreds) {
                  setUpdatingPool(null);
                  setCredsError('');
                  setCredsSuccess('');
                }
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Key size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Rotate Pool Credentials</h3>
                <p className="text-xs text-slate-400">
                  Pool: <span className="text-white font-medium">{updatingPool.name}</span>
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/10 mb-5">
              <p className="text-xs text-slate-300 leading-relaxed">
                Update the login details for this service (e.g. after changing the password for the new billing cycle).
                SplitPay will encrypt the new login with AES-256 and automatically notify and email the new phrase key to all <strong>active, paid members</strong>.
              </p>
            </div>

            {credsError && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle size={15} className="shrink-0" />
                <span>{credsError}</span>
              </div>
            )}

            {credsSuccess && (
              <div className="p-3 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                <CheckCircle2 size={15} className="shrink-0" />
                <span>{credsSuccess}</span>
              </div>
            )}

            <form onSubmit={handleUpdateCredentials} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Service Email or Username
                </label>
                <input
                  type="text"
                  required
                  value={credsForm.username}
                  onChange={(e) => setCredsForm({ ...credsForm, username: e.target.value })}
                  placeholder="e.g. netflix.host@gmail.com"
                  className="w-full bg-[#151722] border border-[#26293b] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  New Service Password
                </label>
                <div className="relative">
                  <input
                    type={showCredsPw ? 'text' : 'password'}
                    required
                    value={credsForm.password}
                    onChange={(e) => setCredsForm({ ...credsForm, password: e.target.value })}
                    placeholder="Enter the updated password on the service"
                    className="w-full bg-[#151722] border border-[#26293b] rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCredsPw(!showCredsPw)}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                  >
                    {showCredsPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    New Passphrase Key (for Encryption)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                      let key = '';
                      for (let i = 0; i < 8; i++) key += chars[Math.floor(Math.random() * chars.length)];
                      setCredsForm({ ...credsForm, phraseKey: key });
                    }}
                    className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
                  >
                    <Sparkles size={11} /> Generate Key
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPhraseKey ? 'text' : 'password'}
                    required
                    value={credsForm.phraseKey}
                    onChange={(e) => setCredsForm({ ...credsForm, phraseKey: e.target.value })}
                    placeholder="Passphrase used to decrypt credentials"
                    className="w-full bg-[#151722] border border-[#26293b] rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPhraseKey(!showPhraseKey)}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                  >
                    {showPhraseKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Active paid members will use this phrase to reveal the new credentials in their vault.
                </p>
              </div>

              <div className="pt-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={credsForm.sendEmail}
                    onChange={(e) => setCredsForm({ ...credsForm, sendEmail: e.target.checked })}
                    className="mt-0.5 rounded border-[#26293b] text-amber-500 focus:ring-amber-500/20 bg-[#151722]"
                  />
                  <span className="text-xs text-slate-300">
                    Automatically email this new phrase key to all active paid subscribers
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#26293b]">
                <button
                  type="button"
                  disabled={updatingCreds}
                  onClick={() => {
                    setUpdatingPool(null);
                    setCredsError('');
                    setCredsSuccess('');
                  }}
                  className="btn-slate-outline text-xs !py-2.5 !px-4"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingCreds}
                  className="btn-solid-white text-xs !py-2.5 !px-5 inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {updatingCreds ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Encrypting & Updating...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={14} className="text-amber-400" />
                      <span>Update & Broadcast</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function HostDisputeChat({ membershipId }: { membershipId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = () => {
    api.get(`/memberships/${membershipId}/dispute/messages`)
      .then((res: any) => setMessages(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const fetchEvidences = () => {
    api.get(`/memberships/${membershipId}/dispute/evidence`)
      .then((res: any) => setEvidences(res.data || []))
      .catch(console.error);
  };

  useEffect(() => {
    fetchMessages();
    fetchEvidences();
    const interval = setInterval(() => {
      fetchMessages();
      fetchEvidences();
    }, 5000);
    return () => clearInterval(interval);
  }, [membershipId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!newMsg.trim()) return;
    setSending(true);
    try {
      const res: any = await api.post(`/memberships/${membershipId}/dispute/messages`, { message: newMsg });
      setMessages(prev => [...prev, res.data]);
      setNewMsg('');
    } catch (err) {
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const uploadEvidence = async (file: File) => {
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
    } catch (err) {
      alert('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

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
          <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Image size={12} /> Evidence
          </h4>
          <div className="flex flex-wrap gap-2 mb-2">
            {evidences.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setPreviewImage(`${UPLOAD_BASE}${ev.fileUrl}`)}
                className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#26293b] hover:border-indigo-500/50 transition-colors"
              >
                <img src={`${UPLOAD_BASE}${ev.fileUrl}`} alt={ev.fileName} className="w-full h-full object-cover" />
                <span className={`absolute top-0.5 left-0.5 text-[8px] font-bold px-1 py-0.5 rounded ${ev.role === 'HOST' ? 'bg-emerald-500/80 text-white' : ev.role === 'ADMIN' ? 'bg-indigo-500/80 text-white' : 'bg-amber-500/80 text-white'}`}>
                  {ev.role}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <MessageCircle size={12} /> Dispute Chat
        </h4>
        <div ref={scrollRef} className="bg-[#0b0c10] border border-[#26293b] rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
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
}