import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Lock, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';

export default function ResetPasswordPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const navigate = useNavigate();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!token) {
            setError('Invalid or missing reset token. Please request a new reset link.');
        }
    }, [token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (!token) {
            setError('Invalid or missing reset token');
            return;
        }

        setLoading(true);
        try {
            await api.post('/auth/reset-password', { token, password });
            setSuccess(true);
        } catch (err: any) {
            setError(err.message || 'Failed to reset password. The link may have expired.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen bg-[#0b0c10] flex items-center justify-center p-4">
                <div className="w-full max-w-md dark-panel border-[#26293b] p-8 text-center">
                    <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-white mb-2">Password Reset Successful</h3>
                    <p className="text-sm text-slate-400 mb-6">
                        Your password has been updated. Please sign in with your new password.
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
            <div className="w-full max-w-md dark-panel border-[#26293b] p-8">
                <h1 className="text-2xl font-bold text-white mb-2 text-center">Set New Password</h1>
                <p className="text-sm text-slate-400 text-center mb-8">
                    Enter your new password below.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">New Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input
                                type="password"
                                required
                                className="w-full bg-[#0b0c10] border border-[#26293b] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">Must be at least 8 characters</p>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Confirm Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input
                                type="password"
                                required
                                className="w-full bg-[#0b0c10] border border-[#26293b] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-400"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    {error && <p className="text-red-400 text-xs">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading || !token}
                        className="w-full btn-solid-white text-sm py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                        {loading ? 'Resetting...' : 'Reset Password'}
                    </button>
                </form>
            </div>
        </div>
    );
}