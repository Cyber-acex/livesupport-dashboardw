const mysql = require("mysql2");
const url = require("url");

let config = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "livesupport",
    port: process.env.DB_PORT || 3306
};

if (process.env.DATABASE_URL) {
    const dbUrl = url.parse(process.env.DATABASE_URL);
    config = {
        host: dbUrl.hostname,
        user: dbUrl.auth.split(':')[0],
        password: dbUrl.auth.split(':')[1],
        database: dbUrl.pathname.slice(1), // remove leading /
        port: dbUrl.port || 3306
    };
}

const db = mysql.createConnection(config);

function connectDatabase(callback) {
    db.connect(err => {
        if (err) {
            console.error("Database error:", err);
            callback(err);
            return;
        }
        console.log("MySQL connected");
        callback();
    });
}

module.exports = { db, connectDatabase };
