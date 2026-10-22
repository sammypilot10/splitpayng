import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ArrowRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function VerifyEmailPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!token) {
            setError('Invalid or missing verification token.');
            setLoading(false);
            return;
        }

        api.post('/auth/verify-email', { token })
            .then(() => {
                setSuccess(true);
                setLoading(false);
            })
            .catch((err: any) => {
                setError(err.message || 'Failed to verify email. The link may have expired.');
                setLoading(false);
            });
    }, [token]);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-4" />
                    <p className="text-sm text-slate-400">Verifying your email...</p>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
                <div className="w-full max-w-md dark-panel border-[#26293b] p-8 text-center">
                    <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-white mb-2">Email Verified!</h3>
                    <p className="text-sm text-slate-400 mb-6">
                        Your email has been verified. You can now create pools and set up payouts.
                    </p>
                    <button
                        onClick={() => navigate('/auth')}
                        className="btn-solid-white text-sm py-3 px-6 inline-flex items-center gap-2"
                    >
                        Sign In <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
            <div className="w-full max-w-md dark-panel border-[#26293b] p-8 text-center">
                <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">Verification Failed</h3>
                <p className="text-sm text-slate-400 mb-6">{error}</p>
                <button
                    onClick={() => navigate('/auth')}
                    className="btn-solid-white text-sm py-3 px-6 inline-flex items-center gap-2"
                >
                    Back to Sign In <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}