import { Crown, Shield, TrendingUp, User } from 'lucide-react';

interface HostBadgeProps {
    score: number;
    successfulPools: number;
    size?: 'sm' | 'md';
}

export default function HostBadge({ score, successfulPools, size = 'sm' }: HostBadgeProps) {
    const getBadge = () => {
        if (score >= 76) return { label: 'Top Rated', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20', icon: Crown };
        if (score >= 51) return { label: 'Trusted Host', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', icon: Shield };
        if (score >= 26 || successfulPools >= 1) return { label: 'Rising Host', color: 'text-blue-400 bg-blue-400/10 border-blue-400/20', icon: TrendingUp };
        return { label: 'New Host', color: 'text-slate-400 bg-slate-400/10 border-slate-400/20', icon: User };
    };

    const badge = getBadge();
    const Icon = badge.icon;
    const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
    const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
    const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';

    return (
        <div className={`inline-flex items-center gap-1 rounded-full border ${padding} ${badge.color}`}>
            <Icon className={iconSize} />
            <span className={`${textSize} font-medium`}>{badge.label}</span>
        </div>
    );
}