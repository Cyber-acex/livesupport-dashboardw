import dotenv from 'dotenv';
dotenv.config({ override: true });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create an adapter with the pool
const adapter = new PrismaPg(pool);

// Initialize Prisma Client with the PostgreSQL adapter
const prisma = new PrismaClient({ adapter });

// Helper function to convert ? placeholders to indexed parameters for raw queries
function convertSqlPlaceholders(sql, params) {
  let paramIndex = 0;
  let result = sql.replace(/\?/g, () => {
    const param = params?.[paramIndex++];
    // Properly escape and format the parameter
    if (param === null || param === undefined) {
      return 'NULL';
    } else if (typeof param === 'string') {
      return `'${param.replace(/'/g, "''")}'`;
    } else if (typeof param === 'number') {
      return param.toString();
    } else if (typeof param === 'boolean') {
      return param ? '1' : '0';
    } else if (param instanceof Date) {
      return `'${param.toISOString()}'`;
    }
    return String(param);
  });
  return result;
}

// Create a compatibility layer that mimics the old db interface
// but uses Prisma under the hood
const db = {
  query(sql, params, callback) {
    // Handle function overloads: db.query(sql, callback) or db.query(sql, params, callback)
    if (typeof params === 'function') {
      callback = params;
      params = [];
    } else if (!Array.isArray(params)) {
      params = params ? [params] : [];
    }

    // Execute asynchronously but support callback pattern
    setImmediate(async () => {
      try {
        const sqlUpper = sql.toUpperCase().trim();
        
        // Skip DDL operations (CREATE, ALTER, DROP) - Prisma manages schema via migrations
        if (sqlUpper.startsWith('CREATE') || sqlUpper.startsWith('ALTER') || sqlUpper.startsWith('DROP')) {
          if (callback) callback(null, { ok: true });
          return;
        }

        // Handle SELECT queries
        if (sqlUpper.startsWith('SELECT')) {
          const convertedSql = convertSqlPlaceholders(sql, params);
          const result = await prisma.$queryRawUnsafe(convertedSql);
          if (callback) callback(null, result);
          return;
        }

        // Handle INSERT, UPDATE, DELETE
        if (sqlUpper.startsWith('INSERT') || sqlUpper.startsWith('UPDATE') || sqlUpper.startsWith('DELETE')) {
          const convertedSql = convertSqlPlaceholders(sql, params);
          const result = await prisma.$executeRawUnsafe(convertedSql);
          if (callback) callback(null, { affectedRows: result });
          return;
        }

        // Fallback for other operations
        if (callback) callback(null, { ok: true });
      } catch (error) {
        console.error('Database query error:', error.message, { sql: sql.substring(0, 100), params });
        if (callback) callback(error);
      }
    });
  },

  promise() {
    return {
      query(sql, params) {
        return new Promise((resolve, reject) => {
          db.query(sql, params, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      }
    };
  }
};

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

const config = { usePostgres: true }; // Always true for Prisma with PostgreSQL

export { db, prisma, connectDatabase, config };
