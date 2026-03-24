const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "livesupport"
});

db.connect(err => {
    if (err) {
        console.log("Database error:", err);
    } else {
        console.log("MySQL connected");
    }
});

module.exports = db;