import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('API has a brand-consistent auth cookie',()=> {
 const s=read('../src/server.ts');
 assert.match(s, /jawaher_session/);
});
test('client only uses same-origin BFF path',()=> {
 for(const name of ['page.tsx','commerce.tsx','ZatcaWorkspace.tsx']) {
  const s=read(`../../web/app/${name}`);
  assert.match(s,/['"]\/backend['"]/);
  assert.doesNotMatch(s,/NEXT_PUBLIC_API_URL/);
 }
});
test('BFF forwards cookies and has safe-origin defense',()=> {
 const s=read('../../web/app/backend/[...path]/route.ts');
 assert.match(s,/set-cookie/);
 assert.match(s,/origin !== req.nextUrl.origin/);
});
test('Supabase migrator and Render config included',()=>{
 assert.ok(existsSync(new URL('../scripts/migrate.mjs',import.meta.url)));
 assert.ok(existsSync(new URL('../../render.yaml',import.meta.url)));
});
test('Redis used for auth rate limiting',()=> {
 const s=read('../src/rate-limit.ts');assert.match(s,/redis\.incr/);assert.match(s,/REDIS_URL/);
});
