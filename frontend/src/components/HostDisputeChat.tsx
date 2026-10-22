import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import { Send, Loader2, Upload, X, AlertTriangle, MessageCircle, Image } from 'lucide-react';

interface Evidence {
    id: string;
    fileUrl: string;
    fileName: string;
    role: string;
    createdAt: string;
}

interface ChatMessage {
    id: string;
    senderId: string;
    senderRole: string;
    message: string;
    createdAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const UPLOAD_BASE = API_BASE; // Evidence files served via authenticated /api/uploads route

interface HostDisputeChatProps {
    membershipId: string;
}

export default function HostDisputeChat({ membershipId }: HostDisputeChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
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
            <div className="flex items-center gap-2 text-red-400 text-xs mb-2">
                <AlertTriangle size={14} /> Member raised a dispute on this subscription
            </div>

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
                <div ref={scrollRef} className="bg-[#0b0c10] border border-[#26293b] rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
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
                                    <p className="text-[10px] text-slate-600 mt-0.5">{new Date(msg.createdAt).toLocaleString('en-NG')}</p>
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
                    className="flex-1 bg-[#151722] border border-[#26293b] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
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