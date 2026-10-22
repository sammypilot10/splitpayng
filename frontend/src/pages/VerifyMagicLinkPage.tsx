import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Loader2, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';

export default function VerifyMagicLinkPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const navigate = useNavigate();
    const { refetchUser } = useAuth();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!token) {
            setError('Invalid or missing magic link token.');
            setLoading(false);
            return;
        }

        // Automatically verify the token on mount
        const verify = async () => {
            try {
                await api.post('/auth/verify-magic-link', { token });
                setSuccess(true);
                // Refresh user state so the app knows we're logged in
                await refetchUser();
                // Redirect to dashboard after a brief pause
                setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
            } catch (err: any) {
                setError(err.message || 'Invalid or expired magic link. Please request a new one.');
            } finally {
                setLoading(false);
            }
        };

        verify();
    }, [token, navigate, refetchUser]);

    return (
        <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
            <div className="w-full max-w-md dark-panel border-[#26293b] p-8 text-center">
                {loading && (
                    <>
                        <Loader2 className="w-12 h-12 text-indigo-400 mx-auto mb-4 animate-spin" />
                        <h3 className="text-lg font-semibold text-white mb-2">Verifying Magic Link</h3>
                        <p className="text-sm text-slate-400">
                            Please wait while we sign you in...
                        </p>
                    </>
                )}

                {success && (
                    <>
                        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-white mb-2">You&apos;re Signed In!</h3>
                        <p className="text-sm text-slate-400 mb-6">
                            Redirecting to your dashboard...
                        </p>
                    </>
                )}

                {error && (
                    <>
                        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-white mb-2">Magic Link Failed</h3>
                        <p className="text-sm text-red-400 mb-6">{error}</p>
                        <button
                            onClick={() => navigate('/auth')}
                            className="btn-solid-white text-sm py-3 px-6 inline-flex items-center gap-2"
                        >
                            Back to Sign In <ArrowRight className="w-4 h-4" />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
