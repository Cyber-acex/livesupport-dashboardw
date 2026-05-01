const mysql = require("mysql2");
const url = require("url");

let config = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "livesupport",
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    queueLimit: 0
};

if (process.env.DATABASE_URL) {
    const dbUrl = url.parse(process.env.DATABASE_URL);
    const auth = (dbUrl.auth || '').split(':');
    config = {
        host: dbUrl.hostname,
        user: auth[0] || config.user,
        password: auth[1] || config.password,
        database: (dbUrl.pathname || '').slice(1) || config.database,
        port: dbUrl.port || config.port,
        waitForConnections: true,
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
        queueLimit: 0
    };
}

// Use a pool so connections are managed and re-used across requests
const db = mysql.createPool(config);

function connectDatabase(callback) {
    // Test acquiring a connection from the pool
    db.getConnection((err, connection) => {
        if (connection) connection.release();
        if (err) {
            console.error('Database connection error:', err);
            if (callback) return callback(err);
            return;
        }
        console.log('MySQL pool is ready');
        if (callback) callback();
    });
}

module.exports = { db, connectDatabase };
