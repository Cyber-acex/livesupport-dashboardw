import { sql } from '../db/database.js'

async function run() {
  try {
    const name = 'Admin'
    const email = 'cyberincognito15@gmail.com'
    const password = '110089'
    const role = 'Admin'

    const result = await sql`INSERT INTO users (name, email, password, role, disabled) VALUES (${name}, ${email}, ${password}, ${role}, ${false}) RETURNING id`
    if (result && result.length) {
      console.log('Inserted user id:', result[0].id)
    } else {
      console.log('Insert returned:', result)
    }
  } catch (err) {
    console.error('Insert error:', err)
  } finally {
    try { await sql.end() } catch (e) {}
  }
}

run()
