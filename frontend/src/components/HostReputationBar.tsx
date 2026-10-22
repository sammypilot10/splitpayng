import HostBadge from './HostBadge';

interface HostReputationBarProps {
    hostName: string;
    reputation: {
        score: number;
        successfulPools: number;
        totalDisputes: number;
        totalMembersServed: number;
    };
}

export default function HostReputationBar({ reputation }: HostReputationBarProps) {
    const disputeRate = reputation.totalMembersServed > 0
        ? Math.round((reputation.totalDisputes / reputation.totalMembersServed) * 100)
        : 0;

    return (
        <div className="flex items-center gap-2 mt-2">
            <HostBadge score={reputation.score} successfulPools={reputation.successfulPools} size="sm" />
            <span className="text-xs text-slate-500">
                {reputation.successfulPools} pool{reputation.successfulPools !== 1 ? 's' : ''}
                {reputation.totalMembersServed > 0 && ` · ${reputation.totalMembersServed} member${reputation.totalMembersServed !== 1 ? 's' : ''}`}
                {disputeRate > 0 && ` · ${disputeRate}% disputes`}
            </span>
        </div>
    );
}