import { useState, useRef } from 'react';
import { Upload, Image, Loader2, X } from 'lucide-react';

interface Evidence {
    id: string;
    fileUrl: string;
    fileName: string;
    role: string;
    createdAt: string;
}

interface EvidenceUploadProps {
    membershipId: string;
    apiPrefix: string;
    disputeId?: string;
    onUpload?: (ev: Evidence) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const UPLOAD_BASE = API_BASE; // Evidence files served via authenticated /api/uploads route

export function EvidenceUpload({ membershipId, apiPrefix, disputeId, onUpload }: EvidenceUploadProps) {
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('evidence', file);

        try {
            const url = apiPrefix === '/admin/disputes' && disputeId
                ? `/memberships/${membershipId}/dispute/evidence`
                : `${apiPrefix}/${membershipId}/dispute/evidence`;

            const res: any = await fetch(`${API_BASE}${url}`, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });

            const data = await res.json();
            if (data.success && onUpload) {
                onUpload(data.data);
            }
        } catch (err) {
            alert('Upload failed');
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    return (
        <div>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                className="hidden"
            />
            <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="btn-slate-outline text-[10px] !py-1.5 !px-2.5 flex items-center gap-1.5 disabled:opacity-50"
            >
                {uploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                Attach Screenshot
            </button>
        </div>
    );
}

export function EvidenceGallery({ evidences }: { evidences: Evidence[] }) {
    const [preview, setPreview] = useState<string | null>(null);

    if (evidences.length === 0) return null;

    return (
        <div className="space-y-2">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Image size={10} /> Evidence ({evidences.length})
            </p>
            <div className="flex flex-wrap gap-2">
                {evidences.map((ev) => (
                    <button
                        key={ev.id}
                        onClick={() => setPreview(ev.fileUrl)}
                        className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#26293b] hover:border-indigo-500/50 transition-colors"
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

            {preview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
                    <div className="relative max-w-2xl max-h-[80vh]">
                        <img src={`${UPLOAD_BASE}${preview}`} alt="Preview" className="max-w-full max-h-[80vh] rounded-xl" />
                        <button
                            onClick={() => setPreview(null)}
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