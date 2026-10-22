import { prisma } from './src/db.js';

async function main() {
    const membershipId = process.argv[2]; // pass membership ID as argument

    if (!membershipId) {
        console.log('Usage: npx tsx check-refund.ts <membershipId>');
        process.exit(1);
    }

    const membership = await prisma.membership.findUnique({
        where: { id: membershipId },
        include: {
            pool: true,
            user: { select: { email: true, fullName: true } },
            disputes: true,
        },
    });

    if (!membership) {
        console.log('Membership not found');
        return;
    }

    console.log('--- Membership ---');
    console.log('Status:', membership.status);
    console.log('User:', membership.user.email);
    console.log('Pool:', membership.pool.name);

    const transaction = await prisma.transaction.findFirst({
        where: { membershipId: membership.id },
        orderBy: { createdAt: 'desc' },
    });

    console.log('\n--- Transaction ---');
    console.log('Reference:', transaction?.reference);
    console.log('Status:', transaction?.status);
    console.log('Amount:', transaction?.amount);

    const payout = transaction ? await prisma.payout.findUnique({
        where: { transactionId: transaction.id },
    }) : null;

    console.log('\n--- Payout ---');
    console.log('Status:', payout?.status);
    console.log('Failure Reason:', payout?.failureReason || 'None');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());