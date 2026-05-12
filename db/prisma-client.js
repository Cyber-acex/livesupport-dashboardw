import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Ensure connection on startup
async function connectDatabase(callback) {
  try {
    await prisma.$connect();
    console.log('✅ Prisma connection is ready');
    if (callback) callback();
  } catch (error) {
    console.error('❌ Prisma connection error:', error.message);
    if (callback) callback(error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export { prisma, connectDatabase };
