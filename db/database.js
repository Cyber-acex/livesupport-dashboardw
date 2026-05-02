const mysql = require("mysql2");


// directly using the credentials below (root@localhost).
const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'livesupport',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelayMs: 0,
    enableStreamingResults: false,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    ssl: process.env.DB_SSL === 'true' ? true : false
};

// Use a pool so connections are managed and re-used across requests
const db = mysql.createPool(config);

function connectDatabase(callback) {
    db.getConnection((err, connection) => {
        if (connection) connection.release();
        if (err) {
            // Avoid logging sensitive SQL internals here; return a sanitized error
            const safe = { code: err.code || 'UNKNOWN', errno: err.errno || null, message: err.message || 'DB error' };
            if (callback) return callback(Object.assign(new Error('DB connection failed'), safe));
            console.error('Database connection error:', safe);
            return;
        }
        console.log('MySQL pool is ready');
        if (callback) callback();
    });
}

module.exports = { db, connectDatabase, config };
