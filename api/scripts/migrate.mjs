import pg from 'pg';
import { readFile } from 'node:fs/promises';
import {resolve} from 'node:path';
const {Client}=pg;
if (!process.env.DATABASE_URL) {console.error('Set DATABASE_URL before running migrations.');process.exit(2)}
const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try {
 await client.connect();
 await client.query(`CREATE TABLE IF NOT EXISTS jawaher_schema_migrations (name text PRIMARY KEY, executed_at timestamptz NOT NULL DEFAULT now())`);
 for (const file of ['001_init.sql','002_commerce.sql','003_zatca_preparation.sql','004_supabase_hardening.sql']) {
   await client.query('BEGIN');
   try {
     const existing=await client.query('SELECT 1 FROM jawaher_schema_migrations WHERE name=$1',[file]);
     if (!existing.rowCount) {
       const sql=await readFile(resolve(import.meta.dirname,'../../db',file),'utf8');
       await client.query(sql);
       await client.query('INSERT INTO jawaher_schema_migrations(name) VALUES($1)',[file]);
       console.log('Applied',file);
     } else console.log('Already applied',file);
     await client.query('COMMIT');
   } catch(e){await client.query('ROLLBACK'); throw e}
 }
 console.log('Database schema ready.');
} catch(e) {console.error('Migration failed:', e.message); process.exitCode=1}
finally {await client.end()}
