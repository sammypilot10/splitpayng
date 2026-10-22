import { prisma } from './src/db.js';

async function main() {
    await prisma.user.update({
        where: { email: 'sammypilot10@gmail.com' },
        data: { role: 'ADMIN' },
    });
    console.log('You are now ADMIN');
}

main();