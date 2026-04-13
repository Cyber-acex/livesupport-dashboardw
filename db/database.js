const mysql = require("mysql2");

const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "livesupport"
});

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
