import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import HostReputationBar from '../components/HostReputationBar';
import { useAuth } from '../hooks/useAuth';
import type { PoolPublic, ApiResponse, PaymentMethod } from '../types';
import {
    Users, CreditCard, ArrowRight, Shield, Zap,
    Film, Music, Gamepad2, BookOpen, Wrench, Grid, CheckCircle2, Lock, Smartphone,
    X, Loader2, AlertTriangle
} from 'lucide-react';

// ─── Optimized Counter: CSS animation instead of JS setInterval ────────────

function AnimatedCounter({ end, prefix = '', suffix = '' }: { end: number; prefix?: string; suffix?: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) setVisible(true);
        }, { threshold: 0.1 });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Once visible, just show the final number. The animation was causing 60 re-renders/sec.
    // If you want animation back, use CSS @keyframes instead of JS.
    return <span ref={ref}>{prefix}{visible ? end.toLocaleString() : '0'}{suffix}</span>;
}

const CATEGORY_ICONS: Record<string, any> = {
    all: Grid,
    streaming: Film,
    music: Music,
    productivity: Zap,
    gaming: Gamepad2,
    education: BookOpen,
    other: Wrench
};

const getCardBrandBadge = (brand: string | null) => {
    const b = (brand || '').toLowerCase();
    if (b.includes('visa')) return { label: 'VISA', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
    if (b.includes('master')) return { label: 'MASTERCARD', bg: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
    if (b.includes('verve')) return { label: 'VERVE', bg: 'bg-teal-500/10 text-teal-400 border-teal-500/20' };
    return { label: 'CARD', bg: 'bg-slate-500/10 text-slate-300 border-slate-500/20' };
};

// ─── Memoized Pool Card ────────────────────────────────────────────────────

interface PoolCardProps {
    pool: PoolPublic;
    onJoin: (pool: PoolPublic) => void;
}

const PoolCard = memo(function PoolCard({ pool, onJoin }: PoolCardProps) {
    const CategoryIcon = CATEGORY_ICONS[pool.category.toLowerCase()] || Grid;
    const progressPercent = Math.min(100, (pool.seatsTaken / pool.totalSeats) * 100);
    const isNewHost = (pool.escrowHours || 48) > 48;

    return (
        <div className="dark-panel p-6 flex flex-col justify-between border-[#26293b] gpu-layer">
            <div>
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#1b1e2b] border border-[#26293b] flex items-center justify-center text-slate-300">
                            <CategoryIcon size={18} />
                        </div>
                        <div>
                            <h4 className="text-base font-bold text-white line-clamp-1">
                                {pool.name}
                            </h4>
                            <span className="text-xs text-slate-400">Host: {pool.hostName}</span>
                            {pool.hostReputation && (
                                <HostReputationBar reputation={pool.hostReputation} hostName={pool.hostName} />
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                        <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider ${pool.poolType === 'PUBLIC' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                            {pool.poolType}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${isNewHost ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`} title={isNewHost ? 'New host — extended 7-day protection' : 'Trusted host — 48h escrow'}>
                            {isNewHost ? '7-Day Escrow' : '48h Escrow'}
                        </span>
                    </div>
                </div>

                <div className="space-y-4 my-5">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                            <Users size={14} /> Available Seats
                        </span>
                        <span className="font-bold text-white">
                            {pool.seatsTaken} / {pool.totalSeats} Taken
                        </span>
                    </div>

                    <div className="w-full bg-[#11131c] rounded-full h-2 border border-[#26293b] overflow-hidden">
                        <div
                            className="bg-slate-200 h-full rounded-full"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2 border-t border-[#26293b]">
                        <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                            <CreditCard size={14} /> Monthly Share Price
                        </span>
                        <span className="font-extrabold text-lg text-white">
                            ₦{pool.pricePerSeat.toLocaleString()} <span className="text-[10px] text-slate-500 font-normal">/ mo</span>
                        </span>
                    </div>
                </div>
            </div>

            <button
                onClick={() => onJoin(pool)}
                className="w-full btn-solid-white text-xs !py-3 flex items-center justify-center gap-1.5 mt-2"
            >
                Join Pool <ArrowRight size={14} />
            </button>
        </div>
    );
});

// ─── Main Component ───────────────────────────────────────────────────────

export default function Marketplace() {
    const [pools, setPools] = useState<PoolPublic[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const { user } = useAuth();

    // Join Checkout Modal State
    const [selectedPoolForJoin, setSelectedPoolForJoin] = useState<PoolPublic | null>(null);
    const [savedCards, setSavedCards] = useState<PaymentMethod[]>([]);
    const [cardsLoading, setCardsLoading] = useState(false);
    const [selectedCardId, setSelectedCardId] = useState<string>('new');
    const [joining, setJoining] = useState(false);
    const [joinSuccess, setJoinSuccess] = useState(false);
    const [joinError, setJoinError] = useState('');

    useEffect(() => {
        api.get<ApiResponse<PoolPublic[]>>('/pools')
            .then((res) => setPools(res.data || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const rawCategories = [...new Set(pools.map((p) => p.category.toLowerCase()))];
    const categories = ['all', ...rawCategories];

    const activePoolsCount = pools.filter(p => p.status === 'ACTIVE').length;
    const totalMembersCount = pools.reduce((acc, p) => acc + p.seatsTaken, 0);
    const totalSavedMonthly = pools.reduce((acc, p) => acc + (p.seatsTaken * p.pricePerSeat * 0.5), 0);

    const filteredPools = selectedCategory === 'all'
        ? pools
        : pools.filter(p => p.category.toLowerCase() === selectedCategory);

    const handleJoinPool = useCallback(async (pool: PoolPublic) => {
        if (!user) {
            window.location.href = `/auth?join=${pool.id}`;
            return;
        }
        setSelectedPoolForJoin(pool);
        setJoinError('');
        setJoinSuccess(false);
        setCardsLoading(true);

        try {
            const res = await api.get<ApiResponse<PaymentMethod[]>>('/payments/methods');
            const methods = res.data || [];
            setSavedCards(methods);
            const defaultCard = methods.find(m => m.isDefault) || methods[0];
            setSelectedCardId(defaultCard ? defaultCard.id : 'new');
        } catch (err) {
            console.error('Failed to load saved payment methods:', err);
            setSelectedCardId('new');
        } finally {
            setCardsLoading(false);
        }
    }, [user]);

    const executeJoin = useCallback(async () => {
        if (!selectedPoolForJoin) return;
        setJoining(true);
        setJoinError('');
        try {
            const useSavedCard = selectedCardId !== 'new';
            const res = await api.post<ApiResponse<any>>('/payments/initialize', {
                poolId: selectedPoolForJoin.id,
                useSavedCard,
                paymentMethodId: useSavedCard ? selectedCardId : undefined,
            });

            if (res.success && res.data) {
                if (res.data.paidWithSavedCard) {
                    if (res.data.result && !res.data.result.success) {
                        setJoinError(res.data.result.message || 'Payment processing failed');
                        setJoining(false);
                        return;
                    }
                    setJoinSuccess(true);
                    setTimeout(() => {
                        window.location.href = '/my-subscriptions';
                    }, 2000);
                } else if (res.data.authorizationUrl) {
                    window.location.href = res.data.authorizationUrl;
                } else {
                    setJoinError(res.message || 'Payment initialization incomplete');
                    setJoining(false);
                }
            } else {
                setJoinError(res.message || 'Payment initialization failed');
                setJoining(false);
            }
        } catch (err: any) {
            setJoinError(err.message || 'Payment processing error');
            setJoining(false);
        }
    }, [selectedPoolForJoin, selectedCardId]);

    return (
        <div className="space-y-16">
            {/* Hero Section */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center pt-4 pb-8">
                <div className="lg:col-span-7 space-y-6">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#151722] border border-[#26293b] text-xs font-semibold text-slate-300">
                        <Shield size={14} className="text-emerald-400" />
                        <span>Automated Escrow Protection</span>
                    </div>

                    <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
                        Split Netflix, Spotify & Premium Subscriptions.<br />
                        <span className="text-slate-400">Pay Only Your Share.</span>
                    </h1>

                    <p className="text-base sm:text-lg text-slate-400 max-w-2xl leading-relaxed">
                        Join verified subscription sharing pools in Nigeria. Access official Netflix, Spotify, ChatGPT, and YouTube Premium accounts for up to <strong className="text-white">75% less</strong> with automated escrow safety.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                        {!user ? (
                            <Link to="/auth" className="btn-solid-white w-full sm:w-auto">
                                Start Sharing Subscriptions <ArrowRight size={18} className="ml-2" />
                            </Link>
                        ) : (
                            <Link to="/create-pool" className="btn-solid-white w-full sm:w-auto">
                                Host a Subscription Pool <ArrowRight size={18} className="ml-2" />
                            </Link>
                        )}
                        <a href="#pools" className="btn-slate-outline w-full sm:w-auto">
                            Browse Active Pools
                        </a>
                    </div>

                    <div className="pt-4 flex items-center gap-6 text-xs text-slate-400 border-t border-[#26293b]">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-emerald-400" /> Instant Access
                        </div>
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-emerald-400" /> AES-256 Encrypted
                        </div>
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-emerald-400" /> Paystack Secured
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-5 flex justify-center">
                    <div className="relative w-full max-w-md">
                        <div className="dark-panel p-3 bg-[#11131c] border-[#26293b] overflow-hidden">
                            <div className="relative rounded-xl overflow-hidden border border-[#26293b]">
                                <img
                                    src="/hero_phone.png"
                                    alt="Person holding smartphone with Netflix subscription sharing screen"
                                    className="w-full h-auto object-cover rounded-xl"
                                    loading="lazy"
                                    decoding="async"
                                />
                                {/* FIX: Removed backdrop-blur-md — replaced with solid semi-transparent bg */}
                                <div className="absolute bottom-4 left-4 right-4 bg-[#0b0c10]/95 p-3.5 rounded-xl border border-[#26293b] flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500 font-black text-xs">
                                            N
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-white">Netflix Premium 4K</div>
                                            <div className="text-[11px] text-slate-400">Shared with 4 Members</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-extrabold text-emerald-400">₦2,750 / mo</div>
                                        <div className="text-[10px] text-slate-500 line-through">₦11,000 full</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="absolute -bottom-5 -left-4 bg-[#151722] border border-[#26293b] p-3 rounded-xl hidden sm:flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                <Smartphone size={16} />
                            </div>
                            <div>
                                <div className="text-xs font-bold text-white">Escrow Verified</div>
                                <div className="text-[10px] text-slate-400">Credentials delivered in 2s</div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Metrics Banner */}
            <section className="dark-panel py-4 px-6 border-[#26293b]">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                    <div className="border-r border-[#26293b] last:border-r-0 pr-4">
                        <div className="text-2xl font-extrabold text-white">
                            <AnimatedCounter end={activePoolsCount || 154} />
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">Active Subscription Pools</div>
                    </div>
                    <div className="border-r border-[#26293b] last:border-r-0 pr-4">
                        <div className="text-2xl font-extrabold text-white">
                            <AnimatedCounter end={totalMembersCount || 920} />
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">Verified Members</div>
                    </div>
                    <div className="border-r border-[#26293b] last:border-r-0 pr-4">
                        <div className="text-2xl font-extrabold text-emerald-400">
                            <AnimatedCounter end={Math.floor(totalSavedMonthly) || 4850000} prefix="₦" />
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">Saved Monthly</div>
                    </div>
                    <div>
                        <div className="text-2xl font-extrabold text-white">48-168h</div>
                        <div className="text-xs text-slate-400 mt-0.5">Dynamic Escrow Protection</div>
                    </div>
                </div>
            </section>

            {/* Pools Catalog */}
            <section id="pools" className="space-y-6">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-extrabold text-white tracking-tight">Browse Subscription Pools</h2>
                        <p className="text-xs text-slate-400 mt-1">Select an active subscription slot to split your monthly bills</p>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto pb-2 max-w-full">
                        {categories.map((cat) => {
                            const IconComponent = CATEGORY_ICONS[cat] || Grid;
                            const isCatActive = selectedCategory === cat;
                            return (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`dark-pill flex items-center gap-2 capitalize whitespace-nowrap ${isCatActive ? 'active' : ''}`}
                                >
                                    <IconComponent size={14} />
                                    <span>{cat}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="dark-panel h-64 animate-pulse bg-slate-900/50" />
                        ))}
                    </div>
                ) : filteredPools.length === 0 ? (
                    <div className="dark-panel p-12 text-center border-[#26293b]">
                        <Film size={36} className="mx-auto text-slate-600 mb-3" />
                        <h3 className="text-lg font-bold text-white mb-1">No pools found in this category</h3>
                        <p className="text-xs text-slate-400 max-w-md mx-auto mb-6">
                            Host your own {selectedCategory} subscription pool and split costs with other members!
                        </p>
                        <Link to="/create-pool" className="btn-solid-white text-xs">
                            Host a Subscription Pool
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredPools.map((pool) => (
                            <PoolCard key={pool.id} pool={pool} onJoin={handleJoinPool} />
                        ))}
                    </div>
                )}
            </section>

            {/* Trust Grid */}
            <section className="dark-panel p-8 sm:p-10 border-[#26293b]">
                <div className="text-center max-w-xl mx-auto mb-10">
                    <h3 className="text-2xl font-extrabold text-white mb-2">How We Protect Your Money</h3>
                    <p className="text-xs text-slate-400">SplitPayNG acts as a neutral escrow clearinghouse between hosts and members.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                        { icon: Shield, title: 'Dynamic Escrow Protection', desc: 'New hosts get 7-day escrow. Trusted hosts get 48h. Your money is safe either way.' },
                        { icon: Zap, title: 'Instant Account Access', desc: 'Decrypt username & password credentials immediately upon joining a pool.' },
                        { icon: CheckCircle2, title: 'Verified Host Profile', desc: 'Hosts are identity-checked to ensure genuine, long-term subscriptions.' },
                        { icon: Lock, title: 'AES-256 Encryption', desc: 'Sensitive credentials are encrypted so only paid pool members can view them.' },
                    ].map((feature) => (
                        <div key={feature.title} className="p-5 rounded-xl bg-[#11131c] border border-[#26293b] gpu-layer">
                            <div className="w-9 h-9 rounded-lg bg-[#151722] border border-[#26293b] flex items-center justify-center mb-3 text-slate-300">
                                <feature.icon size={18} />
                            </div>
                            <h4 className="font-bold text-sm text-white mb-1.5">{feature.title}</h4>
                            <p className="text-xs text-slate-400 leading-relaxed">{feature.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Join Checkout Modal */}
            {selectedPoolForJoin && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="dark-panel p-6 sm:p-8 max-w-lg w-full border-[#26293b] shadow-2xl space-y-6 relative max-h-[90vh] overflow-y-auto">
                        {/* Close button */}
                        <button
                            onClick={() => {
                                if (!joining) {
                                    setSelectedPoolForJoin(null);
                                    setJoinError('');
                                }
                            }}
                            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                            disabled={joining}
                        >
                            <X size={18} />
                        </button>

                        {/* Header */}
                        <div>
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                                    {selectedPoolForJoin.category}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                                    {selectedPoolForJoin.escrowHours || 48}h Escrow Protected
                                </span>
                            </div>
                            <h3 className="text-xl font-bold text-white">{selectedPoolForJoin.name}</h3>
                            <p className="text-xs text-slate-400 mt-0.5">Host: {selectedPoolForJoin.hostName}</p>
                        </div>

                        {/* Pricing Summary */}
                        <div className="bg-[#11131c] p-4 rounded-xl border border-[#26293b] space-y-2.5">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400">Monthly Share Due Today:</span>
                                <span className="text-base font-extrabold text-white">₦{selectedPoolForJoin.pricePerSeat.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-[#1e2230]">
                                <span>Next Renewal Date:</span>
                                <span className="text-slate-300 font-medium">In 30 days (Auto-debited)</span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-slate-400">
                                <span>Escrow Guarantee:</span>
                                <span className="text-emerald-400 font-medium">Full refund if access fails</span>
                            </div>
                        </div>

                        {/* Recurring Card Requirement Callout */}
                        <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-start gap-3">
                            <CreditCard size={18} className="text-indigo-400 mt-0.5 shrink-0" />
                            <div className="text-xs leading-relaxed">
                                <p className="font-semibold text-indigo-300">Continuous Access Card Requirement</p>
                                <p className="text-slate-400 mt-0.5">
                                    Pool subscriptions require an authorized debit/credit card. Your card is securely tokenized via Paystack for recurring monthly renewals so your access is never disrupted.
                                </p>
                            </div>
                        </div>

                        {/* Payment Method Selector */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-slate-300">Choose Payment Method</label>
                                <Link to="/payment-methods" target="_blank" className="text-[11px] text-indigo-400 hover:underline">
                                    Manage Cards
                                </Link>
                            </div>

                            {cardsLoading ? (
                                <div className="p-6 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
                                    <Loader2 size={16} className="animate-spin text-slate-300" />
                                    <span>Checking saved payment methods...</span>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {savedCards.map((card) => {
                                        const badge = getCardBrandBadge(card.brand);
                                        const isSelected = selectedCardId === card.id;
                                        return (
                                            <div
                                                key={card.id}
                                                onClick={() => setSelectedCardId(card.id)}
                                                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                                                    isSelected
                                                        ? 'bg-indigo-500/10 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.15)]'
                                                        : 'bg-[#11131c] border-[#26293b] text-slate-300 hover:border-slate-700'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600'}`}>
                                                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${badge.bg}`}>
                                                                {badge.label}
                                                            </span>
                                                            <span className="text-xs font-mono font-semibold text-white">•••• {card.last4}</span>
                                                            {card.isDefault && (
                                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                                    Default
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[11px] text-slate-500 mt-0.5">
                                                            {card.bank ? `${card.bank} · ` : ''}Expires {card.expMonth}/{card.expYear}
                                                        </div>
                                                    </div>
                                                </div>
                                                <span className="text-[10px] text-emerald-400 font-semibold px-2 py-1 rounded bg-emerald-500/5">
                                                    1-Click
                                                </span>
                                            </div>
                                        );
                                    })}

                                    {/* Pay with a new card option */}
                                    <div
                                        onClick={() => setSelectedCardId('new')}
                                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center gap-3 ${
                                            selectedCardId === 'new'
                                                ? 'bg-indigo-500/10 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.15)]'
                                                : 'bg-[#11131c] border-[#26293b] text-slate-300 hover:border-slate-700'
                                        }`}
                                    >
                                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedCardId === 'new' ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600'}`}>
                                            {selectedCardId === 'new' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs font-medium">
                                            <CreditCard size={15} className="text-slate-400" />
                                            <span>{savedCards.length > 0 ? 'Use a new debit/credit card' : 'Pay with debit/credit card (Card required)'}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Error Message */}
                        {joinError && (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                                <AlertTriangle size={14} className="shrink-0" />
                                <span>{joinError}</span>
                            </div>
                        )}

                        {/* Success Message */}
                        {joinSuccess && (
                            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-1">
                                <CheckCircle2 size={24} className="text-emerald-400 mx-auto" />
                                <p className="text-sm font-bold text-white">Payment Successful!</p>
                                <p className="text-xs text-slate-400">Card authorized and joined pool. Redirecting to your credentials...</p>
                            </div>
                        )}

                        {/* Actions */}
                        {!joinSuccess && (
                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    onClick={() => setSelectedPoolForJoin(null)}
                                    disabled={joining}
                                    className="btn-slate-outline text-xs !py-3 flex-1"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={executeJoin}
                                    disabled={joining || cardsLoading}
                                    className="btn-solid-white text-xs !py-3 flex-1 flex items-center justify-center gap-2 font-bold"
                                >
                                    {joining ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>{selectedCardId !== 'new' ? 'Charging Card...' : 'Initializing Paystack...'}</span>
                                        </>
                                    ) : selectedCardId !== 'new' ? (
                                        <>
                                            <Zap size={14} className="text-amber-400 fill-amber-400" />
                                            <span>Pay ₦{selectedPoolForJoin.pricePerSeat.toLocaleString()} & Join</span>
                                        </>
                                    ) : (
                                        <>
                                            <CreditCard size={14} />
                                            <span>Pay ₦{selectedPoolForJoin.pricePerSeat.toLocaleString()} with Card</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}