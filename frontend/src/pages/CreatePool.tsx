import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { encryptCredentials } from '../utils/encryption';
import type { ApiResponse, Pool } from '../types';
import {
    Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Check, Shield,
    Film, Music, Zap, Gamepad2, BookOpen, Wrench, Layers, DollarSign, Calendar
} from 'lucide-react';

export default function CreatePool() {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();

    const [form, setForm] = useState({
        name: '',
        category: 'streaming',
        poolType: 'PUBLIC' as 'PUBLIC' | 'PRIVATE',
        totalSeats: 4,
        pricePerSeat: 2500,
        renewalDay: 1,
        username: '',
        password: '',
        encryptionPassword: '',
    });

    const categories = [
        { value: 'streaming', label: 'Streaming', icon: Film },
        { value: 'music', label: 'Music', icon: Music },
        { value: 'productivity', label: 'Productivity', icon: Zap },
        { value: 'gaming', label: 'Gaming', icon: Gamepad2 },
        { value: 'education', label: 'Education', icon: BookOpen },
        { value: 'other', label: 'Other', icon: Wrench },
    ];

    const handleSubmit = async () => {
        setError('');
        setLoading(true);

        try {
            // Encrypt credentials before sending
            const encryptedCredentials = encryptCredentials(
                form.username,
                form.password,
                form.encryptionPassword
            );

            const payload = {
                name: form.name,
                category: form.category,
                totalSeats: form.totalSeats,
                pricePerSeat: form.pricePerSeat,
                renewalDay: form.renewalDay,
                encryptedCredentials,
            };

            await api.post<ApiResponse<Pool>>('/pools', payload);
            navigate('/dashboard');
        } catch (err: any) {
            setError(err.message || 'Failed to create pool');
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto py-4">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">Host a Subscription Pool</h1>
                <p className="text-xs text-slate-400">Share your subscription credentials securely and collect monthly share payments</p>
            </div>

            {/* Step Wizard Bar */}
            <div className="flex items-center gap-3 mb-8">
                {[1, 2, 3].map((s) => (
                    <div key={s} className="flex-1 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs transition-all ${s <= step ? 'bg-white text-[#0b0c10]' : 'bg-[#151722] text-slate-500 border border-[#26293b]'}`}>
                            {s < step ? <Check size={16} /> : s}
                        </div>
                        {s < 3 && (
                            <div className={`flex-1 h-1 rounded-full transition-all ${s < step ? 'bg-white' : 'bg-[#26293b]'}`} />
                        )}
                    </div>
                ))}
            </div>

            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                    <Shield size={16} className="shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Dark Panel Container */}
            <div className="dark-panel p-6 sm:p-8 border-[#26293b]">
                {step === 1 && (
                    <div className="space-y-5">
                        <div className="flex items-center gap-2 pb-3 border-b border-[#26293b]">
                            <Layers size={16} className="text-slate-400" />
                            <h3 className="font-bold text-base text-white">Step 1: Subscription Service Details</h3>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Service Name</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="dark-input"
                                placeholder="e.g. Netflix Premium 4K Family"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Category</label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                {categories.map((c) => {
                                    const IconComp = c.icon;
                                    const isSelected = form.category === c.value;
                                    return (
                                        <button
                                            key={c.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, category: c.value })}
                                            className={`p-3 rounded-xl border text-xs font-semibold transition-all flex items-center gap-2 ${isSelected ? 'border-white bg-white text-[#0b0c10]' : 'border-[#26293b] bg-[#11131c] text-slate-400 hover:text-white'}`}
                                        >
                                            <IconComp size={15} />
                                            <span>{c.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Pool Type</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setForm({ ...form, poolType: 'PUBLIC' })}
                                    className={`p-4 rounded-xl border text-left transition-all ${form.poolType === 'PUBLIC' ? 'border-white bg-[#1b1e2b]' : 'border-[#26293b] bg-[#11131c] hover:bg-[#151722]'}`}
                                >
                                    <div className="font-bold text-xs text-white mb-0.5">Public Pool</div>
                                    <div className="text-[11px] text-slate-400">Listed in marketplace with escrow protection</div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setForm({ ...form, poolType: 'PRIVATE' })}
                                    className={`p-4 rounded-xl border text-left transition-all ${form.poolType === 'PRIVATE' ? 'border-white bg-[#1b1e2b]' : 'border-[#26293b] bg-[#11131c] hover:bg-[#151722]'}`}
                                >
                                    <div className="font-bold text-xs text-white mb-0.5">Private Pool</div>
                                    <div className="text-[11px] text-slate-400">Accessible only via invite passphrase</div>
                                </button>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Number of Available Seats</label>
                                <span className="text-xs font-bold text-white px-2.5 py-0.5 rounded-md bg-[#1b1e2b] border border-[#26293b]">{form.totalSeats} Seats</span>
                            </div>
                            <input
                                type="range"
                                min={2}
                                max={10}
                                value={form.totalSeats}
                                onChange={(e) => setForm({ ...form, totalSeats: parseInt(e.target.value) })}
                                className="w-full h-2 bg-[#11131c] rounded-lg appearance-none cursor-pointer accent-white"
                            />
                            <div className="flex justify-between text-[11px] text-slate-500 mt-1 font-mono">
                                <span>2 Seats</span>
                                <span>10 Seats</span>
                            </div>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-5">
                        <div className="flex items-center gap-2 pb-3 border-b border-[#26293b]">
                            <DollarSign size={16} className="text-slate-400" />
                            <h3 className="font-bold text-base text-white">Step 2: Pricing & Billing Cycle</h3>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Monthly Price Per Seat (₦)</label>
                            <div className="relative">
                                <span className="absolute left-4 top-3.5 text-slate-500 font-bold text-sm">₦</span>
                                <input
                                    type="number"
                                    min={100}
                                    value={form.pricePerSeat}
                                    onChange={(e) => setForm({ ...form, pricePerSeat: parseInt(e.target.value) || 0 })}
                                    className="dark-input pl-10"
                                />
                            </div>
                            <div className="mt-3 p-3 rounded-xl bg-[#11131c] border border-[#26293b] flex items-center justify-between text-xs">
                                <span className="text-slate-400">Estimated Monthly Host Earnings:</span>
                                <strong className="text-emerald-400 font-bold text-sm">
                                    ₦{Math.floor(form.pricePerSeat * form.totalSeats * 0.8).toLocaleString()}
                                </strong>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">Calculated after standard 20% platform escrow processing fee.</p>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                <Calendar size={14} /> Subscription Renewal Day (1 - 28)
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={28}
                                value={form.renewalDay}
                                onChange={(e) => setForm({ ...form, renewalDay: parseInt(e.target.value) || 1 })}
                                className="dark-input"
                            />
                            <p className="text-[11px] text-slate-500 mt-1">Members will be charged automatically on this day each month.</p>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="space-y-5">
                        <div className="flex items-center gap-2 pb-3 border-b border-[#26293b]">
                            <Lock size={16} className="text-slate-400" />
                            <h3 className="font-bold text-base text-white">Step 3: Encrypted Credentials</h3>
                        </div>

                        <div className="p-3.5 rounded-xl bg-[#11131c] border border-[#26293b] flex items-start gap-2.5">
                            <Shield size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                            <div className="text-xs text-slate-400 leading-relaxed">
                                Credentials are encrypted using AES-256 before sending. Only verified paid members of your pool can decrypt account details.
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Account Username / Email</label>
                            <input
                                type="text"
                                value={form.username}
                                onChange={(e) => setForm({ ...form, username: e.target.value })}
                                className="dark-input"
                                placeholder="account@example.com"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Account Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                    className="dark-input pr-11"
                                    placeholder="••••••••••••"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300"
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Encryption Passphrase</label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-3.5 h-4 w-4 text-slate-500" />
                                <input
                                    type="password"
                                    value={form.encryptionPassword}
                                    onChange={(e) => setForm({ ...form, encryptionPassword: e.target.value })}
                                    className="dark-input pl-11"
                                    placeholder="Choose a strong passphrase"
                                    required
                                />
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">Keep this passphrase safe — you'll need it to share credentials with members.</p>
                        </div>
                    </div>
                )}

                {/* Navigation Controls */}
                <div className="flex justify-between mt-8 pt-5 border-t border-[#26293b]">
                    {step > 1 ? (
                        <button onClick={() => setStep(step - 1)} className="btn-slate-outline text-xs flex items-center gap-1.5 !py-2.5 !px-4">
                            <ArrowLeft size={14} /> Back
                        </button>
                    ) : <div />}

                    {step < 3 ? (
                        <button onClick={() => setStep(step + 1)} className="btn-solid-white text-xs flex items-center gap-1.5 !py-2.5 !px-5">
                            Next Step <ArrowRight size={14} />
                        </button>
                    ) : (
                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className="btn-solid-white text-xs flex items-center gap-1.5 !py-2.5 !px-6 disabled:opacity-50"
                        >
                            {loading ? (
                                <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Check size={16} /> Create Pool Now
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}