import { prisma } from './src/db.js';
import bcrypt from 'bcryptjs';

async function main() {
    const passwordHash = await bcrypt.hash('password123', 12);

    const user = await prisma.user.create({
        data: {
            email: 'sammypilot10@gmail.com',
            passwordHash,
            fullName: 'Admin User',
            role: 'ADMIN',
            emailVerified: true,
        },
    });

    console.log('Created admin:', user.email);
}

main().catch(console.error).finally(() => prisma.$disconnect());