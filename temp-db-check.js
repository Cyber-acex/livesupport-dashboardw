require('dotenv').config();
const mysql = require('mysql2');
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'livesupport'
});
db.connect(err => {
  if (err) {
    console.error('DB CONNECT ERROR', err);
    process.exit(1);
  }
  const queries = [
    ['daily', "SELECT COUNT(*) AS count FROM messages WHERE sender IN ('customer','received') AND DATE(created_at)=CURDATE()"],
    ['weekly', "SELECT COUNT(*) AS count FROM messages WHERE sender IN ('customer','received') AND YEARWEEK(created_at,1)=YEARWEEK(CURDATE(),1)"],
    ['monthly', "SELECT COUNT(*) AS count FROM messages WHERE sender IN ('customer','received') AND YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())"],
    ['sample', "SELECT id, sender, created_at, message FROM messages ORDER BY id DESC LIMIT 5"]
  ];
  let i = 0;
  function next() {
    if (i >= queries.length) {
      db.end();
      return;
    }
    const [name, sql] = queries[i++];
    db.query(sql, (err, rows) => {
      if (err) {
        console.error(name, err);
        db.end();
        process.exit(1);
      }
      console.log(name, JSON.stringify(rows));
      next();
    });
  }
  next();
});