// This module now uses Prisma ORM instead of direct pg queries
// Import the Prisma-based database implementation
export { db, prisma, connectDatabase, config } from './database-prisma.js';

