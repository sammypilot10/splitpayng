import { prisma } from './src/db.js';

async function main() {
    const poolId = process.argv[2] || 'clz...'; // put your FC2027 pool ID here

    const pool = await prisma.pool.findUnique({
        where: { id: poolId },
    });

    const allMemberships = await prisma.membership.findMany({
        where: { poolId },
        include: { user: { select: { email: true } } },
    });

    const validSeats = allMemberships.filter(m =>
        ['ACTIVE', 'IN_ESCROW', 'DISPUTED'].includes(m.status)
    ).length;

    console.log('Pool:', pool?.name);
    console.log('Pool Status:', pool?.status);
    console.log('Total Seats:', pool?.totalSeats);
    console.log('Valid Seats (ACTIVE/IN_ESCROW/DISPUTED):', validSeats);
    console.log('\nAll Memberships:');
    allMemberships.forEach(m => {
        console.log(`  - ${m.user.email} | Status: ${m.status} | ID: ${m.id}`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());