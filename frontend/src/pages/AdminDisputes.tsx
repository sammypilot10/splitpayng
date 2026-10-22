import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, Loader2, User,
  Calendar, RotateCcw, Clock, Banknote, FileText,
  ChevronDown, ChevronUp, Send, StickyNote, MessageCircle, Upload, Image, X
} from 'lucide-react';

interface Dispute {
  id: string;
  membershipId: string;
  memberName: string;
  memberEmail: string;
  memberJoinedAt: string;
  memberTotalSubs: number;
  memberTotalDisputes: number;
  poolName: string;
  poolHostId: string;
  poolHostName: string;
  poolHostEmail: string;
  poolHostPools: number;
  pricePerSeat: number;
  reason: string;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  messageCount: number;
}

interface TimelineEvent {
  time: string;
  actor: string;
  action: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface TimelineData {
  events: TimelineEvent[];
  transaction: {
    reference: string;
    amount: number;
    platformFee: number;
    hostPayout: number;
    status: string;
    createdAt: string;
  } | null;
  payout: {
    status: string;
    amount: number;
    failureReason: string | null;
  } | null;
  escrowEndsAt: string | null;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: string;
  message: string;
  createdAt: string;
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

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timelineData, setTimelineData] = useState<Record<string, TimelineData>>({});
  const [loadingTimeline, setLoadingTimeline] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [loadingMessages, setLoadingMessages] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState<Record<string, string>>({});
  const [sendingMessage, setSendingMessage] = useState<string | null>(null);
  const [evidences, setEvidences] = useState<Record<string, Evidence[]>>({});
  const [loadingEvidences, setLoadingEvidences] = useState<string | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [action, setAction] = useState<'REFUND' | 'CONFIRM_ACCESS' | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [savingNotes, setSavingNotes] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return;
    fetchDisputes();
  }, [user]);

  const fetchDisputes = () => {
    setLoading(true);
    api.get('/admin/disputes')
      .then((res: any) => setDisputes(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const fetchTimeline = async (disputeId: string) => {
    if (timelineData[disputeId]) return;
    setLoadingTimeline(disputeId);
    try {
      const res: any = await api.get(`/admin/disputes/${disputeId}/timeline`);
      setTimelineData(prev => ({ ...prev, [disputeId]: res.data }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTimeline(null);
    }
  };

  const fetchMessages = async (disputeId: string) => {
    setLoadingMessages(disputeId);
    try {
      const res: any = await api.get(`/admin/disputes/${disputeId}/messages`);
      setMessages(prev => ({ ...prev, [disputeId]: res.data || [] }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(null);
    }
  };

  const fetchEvidences = async (disputeId: string) => {
    setLoadingEvidences(disputeId);
    try {
      const res: any = await api.get(`/admin/disputes/${disputeId}/evidence`);
      setEvidences(prev => ({ ...prev, [disputeId]: res.data || [] }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingEvidences(null);
    }
  };

  const sendMessage = async (disputeId: string) => {
    const text = newMessage[disputeId]?.trim();
    if (!text) return;
    setSendingMessage(disputeId);
    try {
      const res: any = await api.post(`/admin/disputes/${disputeId}/messages`, { message: text });
      setMessages(prev => ({
        ...prev,
        [disputeId]: [...(prev[disputeId] || []), res.data],
      }));
      setNewMessage(prev => ({ ...prev, [disputeId]: '' }));
    } catch (err) {
      alert('Failed to send message');
    } finally {
      setSendingMessage(null);
    }
  };

  const uploadEvidence = async (disputeId: string, membershipId: string, file: File) => {
    setUploadingEvidence(disputeId);
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
        setEvidences(prev => ({
          ...prev,
          [disputeId]: [...(prev[disputeId] || []), data.data],
        }));
      }
    } catch (err) {
      alert('Upload failed');
    } finally {
      setUploadingEvidence(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      fetchTimeline(id);
      fetchMessages(id);
      fetchEvidences(id);
    }
  };

  const saveNotes = async (disputeId: string) => {
    setSavingNotes(disputeId);
    try {
      await api.post(`/admin/disputes/${disputeId}/notes`, { notes: adminNotes[disputeId] || '' });
      setDisputes(prev => prev.map(d => d.id === disputeId ? { ...d, adminNotes: adminNotes[disputeId] || '' } : d));
    } catch (err) {
      alert('Failed to save notes');
    } finally {
      setSavingNotes(null);
    }
  };

  const handleResolve = async (disputeId: string) => {
    if (!action) return;
    setResolvingId(disputeId);
    try {
      await api.post(`/admin/disputes/${disputeId}/resolve`, {
        action,
        adminNotes: adminNotes[disputeId] || '',
      });
      setAction(null);
      setExpandedId(null);
      fetchDisputes();
    } catch (err: any) {
      alert(err.message || 'Failed to resolve dispute');
    } finally {
      setResolvingId(null);
    }
  };

  const getEscrowHours = (endsAt: string | null) => {
    if (!endsAt) return null;
    const hours = Math.ceil((new Date(endsAt).getTime() - Date.now()) / (1000 * 60 * 60));
    return hours > 0 ? hours : 0;
  };

  const getRoleBadge = (role: string) => {
    const styles: Record<string, string> = {
      ADMIN: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      MEMBER: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      HOST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };
    return styles[role] || styles.ADMIN;
  };

  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="dark-panel p-8 border-[#26293b]">
          <Shield size={32} className="mx-auto text-slate-500 mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Admin Only</h2>
          <p className="text-xs text-slate-400">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (disputes.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="dark-panel p-8 border-[#26293b]">
          <div className="w-16 h-16 rounded-2xl bg-[#11131c] border border-[#26293b] flex items-center justify-center mx-auto mb-4 text-slate-400">
            <Shield size={32} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No Active Disputes</h2>
          <p className="text-xs text-slate-400 mb-6">All clear — no disputes to review.</p>
          <button onClick={fetchDisputes} className="btn-slate-outline text-xs !py-2 !px-4 inline-flex items-center gap-1.5">
            <RotateCcw size={12} /> Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 px-4 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Dispute Resolution</h1>
          <p className="text-xs text-slate-400">Review evidence, timeline, and context before resolving</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-semibold flex items-center gap-1.5">
            <AlertTriangle size={12} /> {disputes.length} Open
          </span>
          <button onClick={fetchDisputes} className="btn-slate-outline text-xs !py-1.5 !px-3">
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {disputes.map((d) => {
        const isExpanded = expandedId === d.id;
        const tl = timelineData[d.id];
        const escrowHours = getEscrowHours(tl?.escrowEndsAt || null);
        const chatMessages = messages[d.id] || [];
        const disputeEvidences = evidences[d.id] || [];

        return (
          <div key={d.id} className="dark-panel border-[#26293b] overflow-hidden">
            {/* Header */}
            <div
              className="p-5 sm:p-6 cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => toggleExpand(d.id)}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white">{d.poolName}</h3>
                    <span className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-semibold uppercase tracking-wider">
                      Open
                    </span>
                    {d.messageCount > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-semibold flex items-center gap-1">
                        <MessageCircle size={10} /> {d.messageCount}
                      </span>
                    )}
                    {disputeEvidences.length > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-semibold flex items-center gap-1">
                        <Image size={10} /> {disputeEvidences.length}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><User size={12} /> {d.memberName}</span>
                    <span className="text-slate-600">•</span>
                    <span>{d.memberEmail}</span>
                    <span className="text-slate-600">•</span>
                    <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(d.createdAt).toLocaleDateString('en-NG')}</span>
                    {escrowHours !== null && escrowHours > 0 && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span className="flex items-center gap-1 text-amber-400">
                          <Clock size={12} /> {escrowHours}h left
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 mt-2 leading-relaxed">"{d.reason}"</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-lg font-bold text-white">₦{d.pricePerSeat.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500">Pool Price</div>
                  </div>
                  {isExpanded ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
                </div>
              </div>
            </div>

            {/* Expanded Detail View */}
            {isExpanded && (
              <div className="border-t border-[#26293b] p-5 sm:p-6 space-y-6">
                {/* Context Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-[#11131c] border border-[#26293b]">
                    <div className="flex items-center gap-2 mb-3">
                      <User size={14} className="text-indigo-400" />
                      <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">Member</span>
                    </div>
                    <p className="text-sm font-bold text-white mb-0.5">{d.memberName}</p>
                    <p className="text-xs text-slate-500 mb-3">{d.memberEmail}</p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Joined</span><span className="text-slate-300">{new Date(d.memberJoinedAt).toLocaleDateString('en-NG')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Subscriptions</span><span className="text-slate-300">{d.memberTotalSubs}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Disputes</span><span className={d.memberTotalDisputes > 1 ? 'text-amber-400 font-medium' : 'text-slate-300'}>{d.memberTotalDisputes}</span></div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[#11131c] border border-[#26293b]">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield size={14} className="text-emerald-400" />
                      <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Host</span>
                    </div>
                    <p className="text-sm font-bold text-white mb-0.5">{d.poolHostName}</p>
                    <p className="text-xs text-slate-500 mb-3">{d.poolHostEmail}</p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Active pools</span><span className="text-slate-300">{d.poolHostPools}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Pool price</span><span className="text-slate-300">₦{d.pricePerSeat.toLocaleString()}</span></div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[#11131c] border border-[#26293b]">
                    <div className="flex items-center gap-2 mb-3">
                      <Banknote size={14} className="text-green-400" />
                      <span className="text-[10px] font-semibold text-green-400 uppercase tracking-wider">Financials</span>
                    </div>
                    {tl?.transaction ? (
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Paid</span><span className="text-white font-medium">₦{tl.transaction.amount.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Platform fee</span><span className="text-slate-400">₦{tl.transaction.platformFee.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Host payout</span><span className="text-emerald-400 font-medium">₦{tl.transaction.hostPayout.toLocaleString()}</span></div>
                        <div className="pt-1.5 border-t border-[#26293b] flex justify-between"><span className="text-slate-500">Paystack ref</span><span className="text-slate-300 font-mono text-[10px]">{tl.transaction.reference.slice(0, 14)}...</span></div>
                        {tl.payout && (
                          <div className="flex justify-between"><span className="text-slate-500">Payout</span><span className={tl.payout.status === 'SUCCESS' ? 'text-emerald-400' : tl.payout.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}>{tl.payout.status}</span></div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No transaction data</p>
                    )}
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Clock size={14} /> Timeline
                  </h4>
                  {loadingTimeline === d.id ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading timeline...</div>
                  ) : tl ? (
                    <div className="space-y-3">
                      {tl.events.map((ev, i) => (
                        <div key={i} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className={`w-2 h-2 rounded-full ${ev.type === 'success' ? 'bg-emerald-400' : ev.type === 'warning' ? 'bg-amber-400' : 'bg-slate-500'}`} />
                            {i < tl.events.length - 1 && <div className="w-px flex-1 bg-[#26293b] mt-1" />}
                          </div>
                          <div className="pb-3">
                            <p className="text-xs text-slate-400 mb-0.5">{new Date(ev.time).toLocaleString('en-NG')}</p>
                            <p className="text-xs text-slate-300"><span className="font-semibold text-slate-200">{ev.actor}:</span> {ev.action}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No timeline data</p>
                  )}
                </div>

                {/* Evidence Gallery */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Image size={14} /> Evidence
                  </h4>
                  {loadingEvidences === d.id ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading evidence...</div>
                  ) : disputeEvidences.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {disputeEvidences.map((ev) => (
                        <button
                          key={ev.id}
                          onClick={() => setPreviewImage(`${UPLOAD_BASE}${ev.fileUrl}`)}
                          className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#26293b] hover:border-indigo-500/50 transition-colors"
                        >
                          <img
                            src={`${UPLOAD_BASE}${ev.fileUrl}`}
                            alt={ev.fileName}
                            className="w-full h-full object-cover"
                          />
                          <span className={`absolute top-0.5 left-0.5 text-[8px] font-bold px-1 py-0.5 rounded ${ev.role === 'HOST' ? 'bg-emerald-500/80 text-white' : 'bg-amber-500/80 text-white'}`}>
                            {ev.role}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No evidence uploaded yet.</p>
                  )}
                  <div className="mt-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => e.target.files?.[0] && uploadEvidence(d.id, d.membershipId, e.target.files[0])}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingEvidence === d.id}
                      className="btn-slate-outline text-[10px] !py-1.5 !px-2.5 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {uploadingEvidence === d.id ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                      Upload Evidence
                    </button>
                  </div>
                </div>

                {/* Chat Thread */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <MessageCircle size={14} /> Communications
                  </h4>
                  <div className="bg-[#0b0c10] border border-[#26293b] rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
                    {loadingMessages === d.id ? (
                      <p className="text-xs text-slate-500 text-center py-2">Loading messages...</p>
                    ) : chatMessages.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-2">No messages yet.</p>
                    ) : (
                      chatMessages.map((msg) => (
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
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={newMessage[d.id] || ''}
                      onChange={(e) => setNewMessage(prev => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && sendMessage(d.id)}
                      placeholder="Reply as admin..."
                      className="flex-1 bg-[#151722] border border-[#26293b] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
                    />
                    <button
                      onClick={() => sendMessage(d.id)}
                      disabled={sendingMessage === d.id || !newMessage[d.id]?.trim()}
                      className="btn-solid-white text-xs !py-2 !px-3 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {sendingMessage === d.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    </button>
                  </div>
                </div>

                {/* Admin Notes */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <StickyNote size={14} /> Admin Notes
                  </h4>
                  <textarea
                    value={adminNotes[d.id] !== undefined ? adminNotes[d.id] : (d.adminNotes || '')}
                    onChange={(e) => setAdminNotes(prev => ({ ...prev, [d.id]: e.target.value }))}
                    placeholder="Private notes about this dispute..."
                    rows={3}
                    className="w-full bg-[#0b0c10] border border-[#26293b] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={() => saveNotes(d.id)}
                      disabled={savingNotes === d.id}
                      className="btn-slate-outline text-[10px] !py-1.5 !px-3 disabled:opacity-50"
                    >
                      {savingNotes === d.id ? <Loader2 size={10} className="animate-spin inline mr-1" /> : null}
                      Save Notes
                    </button>
                  </div>
                </div>

                {/* Resolution Actions */}
                <div className="p-4 rounded-xl bg-[#11131c] border border-[#26293b]">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <FileText size={14} /> Resolution
                  </h4>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={() => setAction(action === 'REFUND' ? null : 'REFUND')}
                      className={`flex-1 p-3 rounded-lg border text-left transition-all ${action === 'REFUND' ? 'bg-red-500/10 border-red-500/30' : 'bg-[#0b0c10] border-[#26293b] hover:border-red-500/20'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <XCircle size={14} className={action === 'REFUND' ? 'text-red-400' : 'text-slate-500'} />
                        <span className={`text-xs font-semibold ${action === 'REFUND' ? 'text-red-400' : 'text-slate-300'}`}>Refund Member</span>
                      </div>
                      <p className="text-[10px] text-slate-500">Cancel subscription and refund via Paystack. Pool seat reopens.</p>
                    </button>
                    <button
                      onClick={() => setAction(action === 'CONFIRM_ACCESS' ? null : 'CONFIRM_ACCESS')}
                      className={`flex-1 p-3 rounded-lg border text-left transition-all ${action === 'CONFIRM_ACCESS' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#0b0c10] border-[#26293b] hover:border-emerald-500/20'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 size={14} className={action === 'CONFIRM_ACCESS' ? 'text-emerald-400' : 'text-slate-500'} />
                        <span className={`text-xs font-semibold ${action === 'CONFIRM_ACCESS' ? 'text-emerald-400' : 'text-slate-300'}`}>Confirm Access</span>
                      </div>
                      <p className="text-[10px] text-slate-500">Approve subscription and release host payout.</p>
                    </button>
                  </div>
                  {action && (
                    <div className="mt-3 flex items-center justify-end gap-3">
                      <button onClick={() => setAction(null)} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
                      <button
                        onClick={() => handleResolve(d.id)}
                        disabled={resolvingId === d.id}
                        className={`btn-solid-white text-xs !py-2 !px-4 disabled:opacity-50 ${action === 'REFUND' ? '!bg-red-500 hover:!bg-red-600' : ''}`}
                      >
                        {resolvingId === d.id ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                        Confirm {action === 'REFUND' ? 'Refund' : 'Access'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Image Preview Modal */}
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