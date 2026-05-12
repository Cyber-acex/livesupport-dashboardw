import postgres from 'postgres'

const connectionString = 'postgresql://postgres:eYAaptlB8PC7Py7G@db.ahgfugmvlsfocsrcrkml.supabase.co:5432/postgres'
const sql = postgres(connectionString)

try {
  const result = await sql`SELECT 1 as test`
  console.log('Connection successful:', result)
} catch (error) {
  console.error('Connection failed:', error)
} finally {
  await sql.end()
}