import { prisma } from '../db.js';

export async function recalculateHostReputation(hostId: string) {
    const pools = await prisma.pool.findMany({
        where: { hostId },
        include: {
            memberships: {
                include: {
                    disputes: true,
                },
            },
        },
    });

    // Pools that reached FULL status
    const successfulPools = pools.filter(p => p.status === 'FULL').length;

    // Total disputes across all memberships
    const totalDisputes = pools.reduce(
        (sum, p) => sum + p.memberships.reduce((s, m) => s + m.disputes.length, 0),
        0
    );

    // All paying members ever served (excluding cancelled/failed)
    const totalMembersServed = pools.reduce(
        (sum, p) =>
            sum + p.memberships.filter(m => !['CANCELLED', 'FAILED'].includes(m.status)).length,
        0
    );

    // Calculate score
    let score = 20; // base
    score += Math.min(successfulPools * 15, 45);
    score += Math.min(totalMembersServed * 2, 20);
    score -= totalDisputes * 10;

    const disputeRate = totalMembersServed > 0 ? totalDisputes / totalMembersServed : 0;
    if (disputeRate > 0.2) score -= 30;
    else if (disputeRate > 0.1) score -= 15;
    else if (totalMembersServed > 0 && disputeRate <= 0.05) score += 10;

    score = Math.max(0, Math.min(100, score));

    await prisma.user.update({
        where: { id: hostId },
        data: {
            reputationScore: score,
            successfulPools,
            totalDisputes,
            totalMembersServed,
        },
    });

    return { score, successfulPools, totalDisputes, totalMembersServed, disputeRate };
}

export function getHostBadge(score: number, successfulPools: number) {
    if (score >= 76) return { label: 'Top Rated', color: 'amber', icon: 'crown' as const };
    if (score >= 51) return { label: 'Trusted Host', color: 'green', icon: 'shield' as const };
    if (score >= 26 || successfulPools >= 1) return { label: 'Rising Host', color: 'blue', icon: 'trending-up' as const };
    return { label: 'New Host', color: 'slate', icon: 'user' as const };
}