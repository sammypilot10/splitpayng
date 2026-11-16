import 'dotenv/config';
import { app } from './app.js';
import { prisma } from './db.js';

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);

    try {
        const { runJobs } = await import('./job/scheduler.js');
        await runJobs();
        console.log('[Cron] Jobs scheduled successfully');
    } catch (err: any) {
        console.error('[Cron] Failed to start jobs:', err.message);
    }
});

process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});
