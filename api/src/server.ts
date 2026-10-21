import { AuthRateLimiter } from './rate-limit';
import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Post, Body, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { parseHalalas, validateBalancedLines, InputJournalLine, calculateLine, paymentValid } from './money';
import {validateProfile, preflightDocument, assertSignedEnvelope, validateSubmissionKind, sandboxAvailable, callZatcaSimulation, envelopeFingerprint, ZATCA_SIM_BASE, ZATCA_ENDPOINTS} from './zatca/core';

const scrypt = promisify(scryptCb);
const USER_ROLES = ['owner','accountant','viewer'];
const ACCOUNT_KINDS = ['asset','liability','equity','income','expense'];
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new BadRequestException(message); }
function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
function nonempty(v: unknown, label: string, max=180): string {
  ensure(typeof v === 'string' && v.trim().length>0 && v.trim().length<=max, `${label}: مطلوب أو غير صالح`);
  return v.trim();
}
function dateOnly(v: unknown): string {
  ensure(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v), 'صيغة التاريخ المطلوبة YYYY-MM-DD');
  const d = new Date(`${v}T00:00:00Z`);
  ensure(!Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===v, 'التاريخ غير صالح');
  return v;
}
function dbError(err: unknown): never {
  if (err && typeof err === 'object' && 'code' in err) {
    if ((err as any).code==='23505') throw new ConflictException('القيمة مسجلة مسبقًا');
    if ((err as any).code==='23503') throw new BadRequestException('مرجع البيانات غير صالح');
    if ((err as any).code==='23514') throw new BadRequestException('مخالفة لقواعد البيانات');
  }
  throw err;
}
const CHART: [string,string,string][] = [
 ['1000','الأصول','asset'],['1100','الصندوق','asset'],['1200','البنك','asset'],['1300','العملاء','asset'],['1400','ضريبة مدخلات قابلة للخصم','asset'],
 ['2000','الالتزامات','liability'],['2100','الموردون','liability'],['2200','ضريبة القيمة المضافة المستحقة','liability'],
 ['3000','حقوق الملكية','equity'],['3100','رأس المال','equity'],
 ['4000','الإيرادات','income'],['4100','إيرادات الخدمات','income'],
 ['5000','المصروفات','expense'],['5100','المصروفات التشغيلية','expense'],['5200','إيجارات','expense']
];
@Injectable()
class DataSource {
  readonly pool = new Pool({connectionString:process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_SIZE || 10), connectionTimeoutMillis:7000});
  async transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); const result=await fn(client); await client.query('COMMIT'); return result; }
    catch(error) { await client.query('ROLLBACK'); dbError(error); }
    finally { client.release(); }
  }
}
@Injectable()
class JawaherService {
  constructor(private readonly db:DataSource) {}
  private hash(token:string):string { return createHash('sha256').update(token).digest('hex'); }
  private async hashPassword(password:string):Promise<string> {
    const salt=randomBytes(16).toString('hex');
    const digest=await scrypt(password,salt,64) as Buffer;
    return `${salt}:${digest.toString('hex')}`;
  }
  private async verifyPassword(password:string, saved:string):Promise<boolean> {
    const [salt,expected]=saved.split(':');
    if (!salt || !expected || !/^[0-9a-f]{128}$/.test(expected)) return false;
    const actual=await scrypt(password,salt,64) as Buffer;
    return timingSafeEqual(actual,Buffer.from(expected,'hex'));
  }
  private async createSession(client:PoolClient, userId:string) {
    const token=randomBytes(32).toString('hex');
    await client.query(`INSERT INTO sessions(token_hash,user_id,expires_at)
      VALUES ($1,$2,now()+interval '8 hours')`,[this.hash(token),userId]);
    return token;
  }
  setCookie(res:Response,token:string) {
    res.cookie('jawaher_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',
      path:'/',maxAge:8*3600*1000});
  }
  clearCookie(res:Response) {
    res.clearCookie('jawaher_session',{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',path:'/'});
  }
  private cookie(req:Request):string {
    const raw=req.headers.cookie || '';
    const match=raw.match(/(?:^|;\s*)jawaher_session=([0-9a-f]{64})(?:;|$)/);
    return match?.[1] || '';
  }
  async who(req:Request):Promise<{id:string;email:string}> {
    const token=this.cookie(req);
    if (!token) throw new UnauthorizedException('يلزم تسجيل الدخول');
    const result=await this.db.pool.query(`SELECT u.id,u.email FROM sessions s
      JOIN app_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now()`,[this.hash(token)]);
    if (!result.rowCount) throw new UnauthorizedException('انتهت الجلسة');
    return result.rows[0];
  }
  async allow(req:Request,companyId:string,write=false) {
    ensure(isUuid(companyId),'معرف المنشأة غير صالح');
    const user=await this.who(req);
    const q=await this.db.pool.query('SELECT role FROM memberships WHERE user_id=$1 AND company_id=$2',[user.id,companyId]);
    if (!q.rowCount) throw new ForbiddenException('لا توجد صلاحية لهذه المنشأة');
    if (write && !['owner','accountant'].includes(q.rows[0].role)) throw new ForbiddenException('صلاحية القراءة فقط');
    return {user,role:q.rows[0].role};
  }
  async register(body:any,res:Response) {
    const email=nonempty(body?.email,'البريد',250).toLowerCase();
    ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'البريد الإلكتروني غير صالح');
    const password=body?.password;
    ensure(typeof password==='string' && password.length>=12 && password.length<=128,'كلمة المرور لا تقل عن 12 حرفًا');
    const companyName=nonempty(body?.companyName,'اسم المنشأة');
    const hashed=await this.hashPassword(password);
    const out=await this.db.transaction(async client=>{
      const u=await client.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2) RETURNING id,email',[email,hashed]);
      const t=await client.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',[companyName]);
      const c=await client.query(`INSERT INTO companies(tenant_id,name) VALUES($1,$2) RETURNING id,name,currency`,[t.rows[0].id,companyName]);
      const uid=u.rows[0].id, cid=c.rows[0].id;
      await client.query(`INSERT INTO memberships(company_id,user_id,role) VALUES($1,$2,'owner')`,[cid,uid]);
      const y=new Date().getUTCFullYear();
      await client.query(`INSERT INTO fiscal_periods(company_id,title,starts_on,ends_on) VALUES($1,$2,$3,$4)`,
        [cid,`السنة المالية ${y}`,`${y}-01-01`,`${y}-12-31`]);
      for(const [code,name,kind] of CHART) {
        await client.query(`INSERT INTO accounts(company_id,code,name,kind) VALUES($1,$2,$3,$4)`,[cid,code,name,kind]);
      }
      await client.query(`INSERT INTO audit_events(company_id,actor_id,event,object_id)
        VALUES($1,$2,'company.created',$1)`,[cid,uid]);
      return {user:u.rows[0],company:c.rows[0],token:await this.createSession(client,uid)};
    });
    this.setCookie(res,out.token); return {user:out.user,company:out.company};
  }
  async login(body:any,res:Response) {
    const email=nonempty(body?.email,'البريد',250).toLowerCase();
    ensure(typeof body?.password==='string','كلمة المرور مطلوبة');
    const found=await this.db.pool.query('SELECT id,email,password_hash FROM app_users WHERE email=$1',[email]);
    if (!found.rowCount || !(await this.verifyPassword(body.password,found.rows[0].password_hash)))
      throw new UnauthorizedException('البريد أو كلمة المرور غير صحيحة');
    const token=await this.db.transaction(client=>this.createSession(client,found.rows[0].id));
    this.setCookie(res,token);
    return {user:{id:found.rows[0].id,email}};
  }
  async logout(req:Request,res:Response) {
    const token=this.cookie(req);
    if (token) await this.db.pool.query('DELETE FROM sessions WHERE token_hash=$1',[this.hash(token)]);
    this.clearCookie(res);
    return {ok:true};
  }
  async companies(req:Request) {
    const user=await this.who(req);
    const q=await this.db.pool.query(`SELECT c.id,c.name,c.currency,m.role FROM companies c
      JOIN memberships m ON m.company_id=c.id WHERE m.user_id=$1 ORDER BY c.created_at`,[user.id]);
    return q.rows;
  }
  async accounts(req:Request,cid:string) {
    await this.allow(req,cid);
    const q=await this.db.pool.query('SELECT id,code,name,kind,postable,active FROM accounts WHERE company_id=$1 ORDER BY code',[cid]);
    return q.rows;
  }
  async createAccount(req:Request,cid:string,body:any) {
    const {user}=await this.allow(req,cid,true);
    const code=nonempty(body?.code,'رمز الحساب',24);
    ensure(/^[A-Za-z0-9._-]+$/.test(code),'رمز الحساب يجب أن يتكون من أرقام أو أحرف ورموز بسيطة');
    const name=nonempty(body?.name,'اسم الحساب');
    ensure(ACCOUNT_KINDS.includes(body?.kind),'نوع الحساب غير صالح');
    return this.db.transaction(async client=>{
      const q=await client.query(`INSERT INTO accounts(company_id,code,name,kind)
      VALUES($1,$2,$3,$4) RETURNING id,code,name,kind,postable,active`,[cid,code,name,body.kind]);
      await client.query(`INSERT INTO audit_events(company_id,actor_id,event,object_id)
        VALUES($1,$2,'account.created',$3)`,[cid,user.id,q.rows[0].id]);
      return q.rows[0];
    });
  }
  async periods(req:Request,cid:string) {
    await this.allow(req,cid);
    return (await this.db.pool.query('SELECT id,title,starts_on,ends_on,status FROM fiscal_periods WHERE company_id=$1 ORDER BY starts_on DESC',[cid])).rows;
  }
  async journals(req:Request,cid:string) {
    await this.allow(req,cid);
    const q=await this.db.pool.query(`SELECT j.id,j.entry_date,j.memo,j.status,j.created_at,j.posted_at,
      COALESCE(SUM(l.debit),0)::text AS total
      FROM journal_entries j JOIN journal_lines l ON l.entry_id=j.id
      WHERE j.company_id=$1 GROUP BY j.id ORDER BY j.created_at DESC LIMIT 100`,[cid]);
    return q.rows;
  }
  async journalDetail(req:Request,cid:string,jid:string) {
    await this.allow(req,cid);ensure(isUuid(jid),'معرف القيد غير صالح');
    const j=await this.db.pool.query('SELECT * FROM journal_entries WHERE company_id=$1 AND id=$2',[cid,jid]);
    if (!j.rowCount) throw new NotFoundException('القيد غير موجود');
    const lines=await this.db.pool.query(`SELECT l.account_id,a.code,a.name,l.debit::text,l.credit::text
      FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.company_id=$1 AND l.entry_id=$2 ORDER BY a.code`,[cid,jid]);
    return { ...j.rows[0],lines:lines.rows};
  }
  async createJournal(req:Request,cid:string,body:any) {
    const {user}=await this.allow(req,cid,true);
    const entryDate=dateOnly(body?.entryDate);
    const memo=nonempty(body?.memo,'وصف القيد',500);
    const periodId=body?.periodId;
    ensure(isUuid(periodId),'الفترة المالية مطلوبة');
    const key=nonempty(body?.idempotencyKey,'مفتاح منع التكرار',100);
    const lines=body?.lines as InputJournalLine[];
    ensure(Array.isArray(lines),'سطور القيد مطلوبة');
    try {validateBalancedLines(lines);} catch(e) {throw new BadRequestException((e as Error).message);}
    for (const ln of lines) ensure(isUuid(ln?.accountId),'معرف حساب غير صالح');
    return this.db.transaction(async client=>{
      const period=await client.query(`SELECT id FROM fiscal_periods WHERE company_id=$1 AND id=$2 AND
        status='open' AND starts_on<=$3 AND ends_on>=$3`,[cid,periodId,entryDate]);
      if (!period.rowCount) throw new BadRequestException('الفترة غير مفتوحة أو التاريخ خارج الفترة');
      const ids=[...new Set(lines.map(l=>l.accountId))];
      const ac=await client.query(`SELECT id FROM accounts WHERE company_id=$1 AND id=ANY($2::uuid[]) AND active=true AND postable=true`,[cid,ids]);
      if (ac.rows.length!==ids.length) throw new BadRequestException('يوجد حساب غير متاح أو غير تابع للمنشأة');
      const j=await client.query(`INSERT INTO journal_entries(company_id,period_id,entry_date,memo,idempotency_key,created_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,entry_date,memo,status`,[cid,periodId,entryDate,memo,key,user.id]);
      for(const ln of lines) {
        await client.query(`INSERT INTO journal_lines(company_id,entry_id,account_id,debit,credit)
          VALUES($1,$2,$3,$4,$5)`,[cid,j.rows[0].id,ln.accountId,parseHalalas(ln.debit).toString()==='0'?'0.00':ln.debit,
          parseHalalas(ln.credit).toString()==='0'?'0.00':ln.credit]);
      }
      await client.query(`INSERT INTO audit_events(company_id,actor_id,event,object_id)
        VALUES($1,$2,'journal.drafted',$3)`,[cid,user.id,j.rows[0].id]);
      return j.rows[0];
    });
  }
  async postJournal(req:Request,cid:string,jid:string) {
    const {user}=await this.allow(req,cid,true);ensure(isUuid(jid),'معرف القيد غير صالح');
    return this.db.transaction(async client=>{
      const j=await client.query(`SELECT j.id,j.status,j.entry_date,p.status AS period_status,p.starts_on,p.ends_on
        FROM journal_entries j JOIN fiscal_periods p ON p.id=j.period_id
        WHERE j.company_id=$1 AND j.id=$2 FOR UPDATE OF j,p`,[cid,jid]);
      if (!j.rowCount) throw new NotFoundException('القيد غير موجود');
      if (j.rows[0].status!=='draft') throw new ConflictException('القيد مرحّل سابقًا');
      if (j.rows[0].period_status!=='open') throw new BadRequestException('الفترة مغلقة');
      const lineCheck=await client.query(`SELECT COUNT(*)::int AS count,SUM(debit)::text AS debit,SUM(credit)::text AS credit,
        BOOL_AND(a.active AND a.postable) AS accounts_ok
        FROM journal_lines l JOIN accounts a ON a.id=l.account_id
        WHERE l.company_id=$1 AND l.entry_id=$2`,[cid,jid]);
      const v=lineCheck.rows[0];
      if (v.count<2 || !v.accounts_ok || !v.debit || v.debit!==v.credit || Number(v.debit)<=0)
        throw new BadRequestException('القيد غير متوازن أو حساباته غير متاحة');
      await client.query(`UPDATE journal_entries SET status='posted',posted_at=now() WHERE company_id=$1 AND id=$2`,[cid,jid]);
      await client.query(`INSERT INTO audit_events(company_id,actor_id,event,object_id)
        VALUES($1,$2,'journal.posted',$3)`,[cid,user.id,jid]);
      return {id:jid,status:'posted'};
    });
  }
  async trialBalance(req:Request,cid:string,asOf?:string) {
    await this.allow(req,cid);
    const through=asOf?dateOnly(asOf):new Date().toISOString().slice(0,10);
    const q=await this.db.pool.query(`SELECT a.id,a.code,a.name,a.kind,
       COALESCE(SUM(l.debit),0)::text AS debit,
       COALESCE(SUM(l.credit),0)::text AS credit,
       COALESCE(SUM(l.debit-l.credit),0)::text AS net
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id AND l.company_id=a.company_id
       AND EXISTS(SELECT 1 FROM journal_entries j WHERE j.id=l.entry_id
         AND j.company_id=a.company_id AND j.status='posted' AND j.entry_date<=$2)
      WHERE a.company_id=$1 GROUP BY a.id ORDER BY a.code`,[cid,through]);
    // PostgreSQL NUMERIC => JS strings; preserve precision, leave balance columns as decimals.
    let totalDebit=0n,totalCredit=0n;
    const rows=q.rows.map((r:any)=>{
      const value=r.net.startsWith('-') ? -parseHalalas(r.net.slice(1)) : parseHalalas(r.net);
      const debit=value>0n?value:0n,credit=value<0n?-value:0n;
      totalDebit+=debit;totalCredit+=credit;
      return {...r,debitBalance:(debit/100n)+'.'+(debit%100n).toString().padStart(2,'0'),
        creditBalance:(credit/100n)+'.'+(credit%100n).toString().padStart(2,'0')};
    });
    return {asOf:through,rows,totals:{debit:(totalDebit/100n)+'.'+(totalDebit%100n).toString().padStart(2,'0'),
      credit:(totalCredit/100n)+'.'+(totalCredit%100n).toString().padStart(2,'0')}};
  }
  async dashboard(req:Request,cid:string) {
    await this.allow(req,cid);
    const q=await this.db.pool.query(`SELECT
      (SELECT COUNT(*)::int FROM accounts WHERE company_id=$1) AS accounts,
      (SELECT COUNT(*)::int FROM journal_entries WHERE company_id=$1 AND status='posted') AS posted_journals,
      (SELECT COUNT(*)::int FROM journal_entries WHERE company_id=$1 AND status='draft') AS draft_journals`,[cid]);
    return {...q.rows[0],currency:'SAR'};
  }
  async audit(req:Request,cid:string) {
    await this.allow(req,cid);
    return (await this.db.pool.query(`SELECT a.event,a.created_at,a.object_id,u.email
      FROM audit_events a JOIN app_users u ON u.id=a.actor_id
      WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT 50`,[cid])).rows;
  }
  async checkHealth(){await this.db.pool.query('SELECT 1');return {status:'ok',database:'connected',version:'2.0.0'};}
}
@Controller()
class JawaherController {
  constructor(private readonly app:JawaherService, private readonly limiter:AuthRateLimiter) {}
  @Get('health') health(){return this.app.checkHealth();}
  @Post('auth/register') async register(@Req() req:Request,@Body() body:any,@Res({passthrough:true}) res:Response){await this.limiter.check(req,'register',String(body?.email||''));return this.app.register(body,res);}
  @Post('auth/login') async login(@Req() req:Request,@Body() body:any,@Res({passthrough:true}) res:Response){await this.limiter.check(req,'login',String(body?.email||''));return this.app.login(body,res);}
  @Post('auth/logout') logout(@Req() req:Request,@Res({passthrough:true}) res:Response){return this.app.logout(req,res);}
  @Get('auth/me') me(@Req() req:Request){return this.app.who(req);}
  @Get('companies') companies(@Req() req:Request){return this.app.companies(req);}
  @Get('companies/:cid/dashboard') dashboard(@Req() req:Request,@Param('cid') c:string){return this.app.dashboard(req,c);}
  @Get('companies/:cid/accounts') accounts(@Req() req:Request,@Param('cid') c:string){return this.app.accounts(req,c);}
  @Post('companies/:cid/accounts') createAccount(@Req() req:Request,@Param('cid') c:string,@Body() body:any){return this.app.createAccount(req,c,body);}
  @Get('companies/:cid/periods') periods(@Req() req:Request,@Param('cid') c:string){return this.app.periods(req,c);}
  @Get('companies/:cid/journals') journals(@Req() req:Request,@Param('cid') c:string){return this.app.journals(req,c);}
  @Post('companies/:cid/journals') createJournal(@Req() req:Request,@Param('cid') c:string,@Body() body:any){return this.app.createJournal(req,c,body);}
  @Get('companies/:cid/journals/:jid') journal(@Req() req:Request,@Param('cid') c:string,@Param('jid') j:string){return this.app.journalDetail(req,c,j);}
  @Post('companies/:cid/journals/:jid/post') postJournal(@Req() req:Request,@Param('cid') c:string,@Param('jid') j:string){return this.app.postJournal(req,c,j);}
  @Get('companies/:cid/reports/trial-balance') trial(@Req() req:Request,@Param('cid') c:string,@Query('asOf') asOf?:string){return this.app.trialBalance(req,c,asOf);}
  @Get('companies/:cid/audit') audit(@Req() req:Request,@Param('cid') c:string){return this.app.audit(req,c);}
}
// Additional business modules: all writes are tenant-scoped, authenticated and transactional.
type CommerceLine = { description:string; quantity:number; unitPrice:string; taxRate:number };
function moneyInput(value:unknown, label:string, allowZero=true):bigint {
  try { const n=parseHalalas(value); if (!allowZero && n===0n) throw Error('zero'); return n; }
  catch { throw new BadRequestException(`${label}: المبلغ غير صالح`); }
}
function amount(h:bigint):string {
  const negative=h<0n; const n=negative?-h:h;
  return `${negative?'-':''}${n/100n}.${String(n%100n).padStart(2,'0')}`;
}
function checkKind(v:any, options:string[], label:string){ ensure(options.includes(v),`${label} غير صالح`); return v as string; }
function optionalStr(v:unknown,max=180):string|null {
  if(v===null||v===undefined||v==='') return null;
  ensure(typeof v==='string'&&v.trim().length<=max,'قيمة نصية غير صالحة');return v.trim();
}
@Injectable()
class CommerceService {
 constructor(private readonly db:DataSource, private readonly core:JawaherService){}
 private async log(c:PoolClient,cid:string,uid:string,event:string,id:string){
   await c.query(`INSERT INTO audit_events(company_id,actor_id,event,object_id) VALUES($1,$2,$3,$4)`,[cid,uid,event,id]);
 }
 async contacts(req:Request,cid:string){
   await this.core.allow(req,cid); return (await this.db.pool.query(
     `SELECT * FROM contacts WHERE company_id=$1 ORDER BY created_at DESC LIMIT 500`,[cid])).rows;
 }
 async addContact(req:Request,cid:string,b:any){
   const {user}=await this.core.allow(req,cid,true);
   const name=nonempty(b?.name,'اسم جهة الاتصال');const kind=checkKind(b?.kind,['customer','supplier','both'],'النوع');
   const email=optionalStr(b?.email,250),phone=optionalStr(b?.phone,30),tax=optionalStr(b?.taxNumber,35);
   if(email) ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'البريد غير صالح');
   return this.db.transaction(async c=>{
     const r=await c.query(`INSERT INTO contacts(company_id,name,kind,email,phone,tax_number)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[cid,name,kind,email,phone,tax]);
     await this.log(c,cid,user.id,'contact.created',r.rows[0].id);return r.rows[0];
   });
 }
 async catalog(req:Request,cid:string){
   await this.core.allow(req,cid);return (await this.db.pool.query('SELECT * FROM catalog_items WHERE company_id=$1 ORDER BY created_at DESC LIMIT 500',[cid])).rows;
 }
 async addCatalog(req:Request,cid:string,b:any){
   const {user}=await this.core.allow(req,cid,true);
   const name=nonempty(b?.name,'اسم الصنف'),kind=checkKind(b?.kind,['service','product'],'التصنيف');
   const unit=optionalStr(b?.unit,25)||'وحدة';
   const price=amount(moneyInput(b?.price,'السعر'));
   const sku=optionalStr(b?.sku,48);
   return this.db.transaction(async c=>{
     const r=await c.query(`INSERT INTO catalog_items(company_id,sku,name,kind,unit,price)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[cid,sku,name,kind,unit,price]);
     await this.log(c,cid,user.id,'catalog.created',r.rows[0].id);return r.rows[0];
   });
 }
 async documents(req:Request,cid:string,kind:string){
   await this.core.allow(req,cid);checkKind(kind,['sale','purchase'],'نوع المستند');
   return (await this.db.pool.query(`SELECT d.id,d.document_no,d.kind,d.status,d.issue_date,d.due_date,d.reference,
     d.subtotal::text,d.vat_total::text,d.grand_total::text,d.paid_total::text,d.zatca_status,
     c.name AS contact_name,c.id AS contact_id,d.created_at FROM business_documents d
     JOIN contacts c ON c.id=d.contact_id WHERE d.company_id=$1 AND d.kind=$2
     ORDER BY d.created_at DESC LIMIT 500`,[cid,kind])).rows;
 }
 async document(req:Request,cid:string,id:string){
   await this.core.allow(req,cid);ensure(isUuid(id),'معرف المستند غير صالح');
   const head=await this.db.pool.query(`SELECT d.*,c.name AS contact_name FROM business_documents d JOIN contacts c ON c.id=d.contact_id
     WHERE d.company_id=$1 AND d.id=$2`,[cid,id]);
   if(!head.rowCount) throw new NotFoundException('المستند غير موجود');
   const [lines,payments]=await Promise.all([
     this.db.pool.query('SELECT description,quantity,unit_price::text,tax_rate,line_subtotal::text,line_tax::text FROM document_lines WHERE document_id=$1',[id]),
     this.db.pool.query('SELECT paid_on,amount::text FROM document_payments WHERE document_id=$1 ORDER BY created_at DESC',[id])]);
   return {...head.rows[0],lines:lines.rows,payments:payments.rows};
 }
 async addDocument(req:Request,cid:string,kind:string,b:any){
   const {user}=await this.core.allow(req,cid,true);checkKind(kind,['sale','purchase'],'نوع المستند');
   ensure(isUuid(b?.contactId),'العميل أو المورد غير صالح');
   const when=dateOnly(b?.issueDate),due=dateOnly(b?.dueDate);
   ensure(due>=when,'الاستحقاق لا يسبق تاريخ المستند');
   const key=nonempty(b?.idempotencyKey,'مفتاح منع التكرار',150);
   const raw=b?.lines;ensure(Array.isArray(raw)&&raw.length>=1&&raw.length<=100,'يجب تحديد بنود من 1 إلى 100');
   let subtotal=0n,taxTotal=0n;
   const lines: (CommerceLine&{net:bigint;tax:bigint})[]=raw.map((r:any)=>{
     const description=nonempty(r?.description,'وصف البند',500);
     ensure(Number.isInteger(r?.quantity)&&r.quantity>=1&&r.quantity<=100000,'الكمية غير صالحة');
     ensure([0,15].includes(r?.taxRate),'التجربة تدعم 0 أو 15 فقط');
     const unitPrice=moneyInput(r?.unitPrice,'سعر الوحدة');
     const calculated=calculateLine(r.quantity,amount(unitPrice),r.taxRate);
     const net=parseHalalas(calculated.net);
     const tax=parseHalalas(calculated.tax);
     ensure(net<=999999999999999999n && tax<=999999999999999999n,'قيمة البند كبيرة جدًا');
     subtotal+=net;taxTotal+=tax;
     return {description,quantity:r.quantity,unitPrice:amount(unitPrice),taxRate:r.taxRate,net,tax};
   });
   const total=subtotal+taxTotal;ensure(total>0n,'المستند بلا مبلغ');
   ensure(total<=999999999999999999n,'الإجمالي يتجاوز الحد');
   return this.db.transaction(async c=>{
     const contact=await c.query('SELECT kind FROM contacts WHERE id=$1 AND company_id=$2',[b.contactId,cid]);
     if(!contact.rowCount|| !([kind==='sale'?'customer':'supplier','both'].includes(contact.rows[0].kind)))
       throw new BadRequestException('جهة الاتصال لا تطابق نوع المستند');
     const period=await c.query(`SELECT id FROM fiscal_periods WHERE company_id=$1 AND status='open'
       AND starts_on<=$2::date AND ends_on>=$2::date ORDER BY starts_on DESC LIMIT 1`,[cid,when]);
     if(!period.rowCount) throw new BadRequestException('لا توجد فترة مالية مفتوحة لتاريخ المستند');
     const r=await c.query(`INSERT INTO business_documents(company_id,kind,contact_id,period_id,
        issue_date,due_date,reference,subtotal,vat_total,grand_total,created_by,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id,document_no,kind,status,grand_total::text`,[cid,kind,b.contactId,period.rows[0].id,
        when,due,optionalStr(b?.reference,160),amount(subtotal),amount(taxTotal),amount(total),user.id,key]);
     for(const line of lines) await c.query(`INSERT INTO document_lines(company_id,document_id,description,
       quantity,unit_price,tax_rate,line_subtotal,line_tax) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
       [cid,r.rows[0].id,line.description,line.quantity,line.unitPrice,line.taxRate,amount(line.net),amount(line.tax)]);
     await this.log(c,cid,user.id,`document.${kind}.drafted`,r.rows[0].id);return r.rows[0];
   });
 }
 private async codeAccounts(c:PoolClient,cid:string,codes:string[]):Promise<Map<string,string>>{
   const rows=await c.query(`SELECT code,id FROM accounts WHERE company_id=$1 AND code=ANY($2::text[])
     AND active=true AND postable=true FOR SHARE`,[cid,codes]);
   const m=new Map<string,string>(rows.rows.map(r=>[r.code,r.id]));
   for(const code of codes) if(!m.has(code)) throw new BadRequestException(`الحساب ${code} غير موجود أو معطل`);
   return m;
 }
 private async journal(c:PoolClient,cid:string,uid:string,period:string,date:string,memo:string,key:string,
    lines:Array<{code:string;debit:bigint;credit:bigint}>){
   const codes=[...new Set(lines.map(l=>l.code))];const a=await this.codeAccounts(c,cid,codes);
   const debit=lines.reduce((n,l)=>n+l.debit,0n),credit=lines.reduce((n,l)=>n+l.credit,0n);
   ensure(debit>0n&&debit===credit&&lines.length>=2,'القيد الناتج غير متوازن');
   const j=await c.query(`INSERT INTO journal_entries(company_id,period_id,entry_date,memo,idempotency_key,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[cid,period,date,memo,key,uid]);
   for(const l of lines.filter(l=>l.debit>0n||l.credit>0n)){
     await c.query(`INSERT INTO journal_lines(company_id,entry_id,account_id,debit,credit)
       VALUES($1,$2,$3,$4,$5)`,[cid,j.rows[0].id,a.get(l.code),amount(l.debit),amount(l.credit)]);
   }
   await c.query(`UPDATE journal_entries SET status='posted',posted_at=now() WHERE id=$1 AND company_id=$2`,[j.rows[0].id,cid]);
   await this.log(c,cid,uid,'journal.posted',j.rows[0].id);return j.rows[0].id as string;
 }
 async issueDocument(req:Request,cid:string,id:string){
   const {user}=await this.core.allow(req,cid,true);ensure(isUuid(id),'معرف غير صالح');
   return this.db.transaction(async c=>{
     const r=await c.query(`SELECT d.*,p.status AS period_status FROM business_documents d
       JOIN fiscal_periods p ON p.id=d.period_id AND p.company_id=d.company_id
       WHERE d.company_id=$1 AND d.id=$2 FOR UPDATE OF d,p`,[cid,id]);
     if(!r.rowCount) throw new NotFoundException('المستند غير موجود');
     const d=r.rows[0];if(d.status!=='draft') throw new ConflictException('المستند مرحّل أو معالج');
     if(d.period_status!=='open') throw new BadRequestException('الفترة مغلقة');
     const subtotal=moneyInput(String(d.subtotal),'صافي'),vat=moneyInput(String(d.vat_total),'ضريبة');
     const total=subtotal+vat;
     const entries=d.kind==='sale' ? [
       {code:'1300',debit:total,credit:0n},
       {code:'4100',debit:0n,credit:subtotal},
       ...(vat>0n?[{code:'2200',debit:0n,credit:vat}]:[])
     ] : [
       {code:'5100',debit:subtotal,credit:0n},
       ...(vat>0n?[{code:'1400',debit:vat,credit:0n}]:[]),
       {code:'2100',debit:0n,credit:total}
     ];
     const jid=await this.journal(c,cid,user.id,d.period_id,new Date(d.issue_date).toISOString().slice(0,10),
       `${d.kind==='sale'?'فاتورة بيع':'فاتورة شراء'} رقم ${d.document_no}`,`business:${id}`,entries);
     await c.query(`UPDATE business_documents SET status='issued',journal_id=$1,issued_at=now() WHERE id=$2`,[jid,id]);
     await this.log(c,cid,user.id,`document.${d.kind}.issued`,id);
     return {id,status:'issued',journalId:jid,zatcaStatus:'not_connected'};
   });
 }
 async receivePayment(req:Request,cid:string,id:string,b:any){
   const {user}=await this.core.allow(req,cid,true);ensure(isUuid(id),'معرف غير صالح');
   const date=dateOnly(b?.paidOn),v=moneyInput(b?.amount,'المبلغ',false);
   const key=nonempty(b?.idempotencyKey,'مفتاح منع التكرار',150);
   return this.db.transaction(async c=>{
     const q=await c.query(`SELECT d.*,p.id AS payment_period_id,p.status AS period_status,p.starts_on,p.ends_on
       FROM business_documents d JOIN fiscal_periods p ON p.company_id=d.company_id
       AND p.starts_on<=$3::date AND p.ends_on>=$3::date
       WHERE d.company_id=$1 AND d.id=$2 AND p.status='open' FOR UPDATE OF d,p`,[cid,id,date]);
     if(!q.rowCount) throw new BadRequestException('المستند غير موجود أو الفترة غير مفتوحة');
     const d=q.rows[0];ensure(['issued','partial'].includes(d.status),'المستند لا يقبل سدادًا');

     const due=moneyInput(String(d.grand_total),'الإجمالي')-moneyInput(String(d.paid_total),'المسدد');
     ensure(paymentValid(String(d.grand_total),String(d.paid_total),amount(v)) && v<=due,'مبلغ السداد أكبر من المتبقي');
     const codes=d.kind==='sale' ? [
       {code:'1200',debit:v,credit:0n},{code:'1300',debit:0n,credit:v}
     ] : [
       {code:'2100',debit:v,credit:0n},{code:'1200',debit:0n,credit:v}
     ];
     const jid=await this.journal(c,cid,user.id,d.payment_period_id,date,
       `${d.kind==='sale'?'تحصيل':'سداد'} مستند ${d.document_no}`,`payment:${cid}:${key}`,codes);
     const payment=await c.query(`INSERT INTO document_payments(company_id,document_id,journal_id,paid_on,
       amount,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
       [cid,id,jid,date,amount(v),user.id,key]);
     const status=v===due?'paid':'partial';
     await c.query(`UPDATE business_documents SET paid_total=paid_total+$1,status=$2 WHERE company_id=$3 AND id=$4`,
       [amount(v),status,cid,id]);
     await this.log(c,cid,user.id,'document.payment',payment.rows[0].id);
     return {id:payment.rows[0].id,status,amount:amount(v),journalId:jid};
   });
 }
 async financial(req:Request,cid:string,asOf?:string){
   await this.core.allow(req,cid);const date=asOf?dateOnly(asOf):new Date().toISOString().slice(0,10);
   const a=await this.db.pool.query(`SELECT a.kind,
     COALESCE(SUM(l.debit),0)::text AS debit,COALESCE(SUM(l.credit),0)::text AS credit
      FROM accounts a JOIN journal_lines l ON l.account_id=a.id AND l.company_id=a.company_id
      JOIN journal_entries j ON j.id=l.entry_id AND j.company_id=a.company_id
      WHERE a.company_id=$1 AND j.status='posted' AND j.entry_date<=$2
      GROUP BY a.kind`,[cid,date]);
   const values:Record<string,bigint>={asset:0n,liability:0n,equity:0n,income:0n,expense:0n};
   for(const row of a.rows){
     const d=moneyInput(row.debit,'مدين'),c=moneyInput(row.credit,'دائن');
     values[row.kind]=(row.kind==='asset'||row.kind==='expense')?d-c:c-d;
   }
   const net=values.income-values.expense;
   const q=await this.db.pool.query(`SELECT
     (SELECT COUNT(*)::int FROM contacts WHERE company_id=$1) contacts,
     (SELECT COUNT(*)::int FROM catalog_items WHERE company_id=$1) items,
     (SELECT COUNT(*)::int FROM business_documents WHERE company_id=$1 AND kind='sale') sales,
     (SELECT COUNT(*)::int FROM business_documents WHERE company_id=$1 AND kind='purchase') purchases,
     (SELECT COALESCE(SUM(d.grand_total-COALESCE((SELECT SUM(p.amount) FROM document_payments p WHERE p.document_id=d.id AND p.paid_on<=$2::date),0)),0)::text
       FROM business_documents d WHERE d.company_id=$1 AND d.kind='sale' AND d.issue_date<=$2::date AND d.status!='draft') receivables,
     (SELECT COALESCE(SUM(d.grand_total-COALESCE((SELECT SUM(p.amount) FROM document_payments p WHERE p.document_id=d.id AND p.paid_on<=$2::date),0)),0)::text
       FROM business_documents d WHERE d.company_id=$1 AND d.kind='purchase' AND d.issue_date<=$2::date AND d.status!='draft') payables`,[cid,date]);
   return {asOf:date,currency:'SAR',income:amount(values.income),expenses:amount(values.expense),netProfit:amount(net),
      assets:amount(values.asset),liabilities:amount(values.liability),equity:amount(values.equity),
      retainedEarnings:amount(net),equationBalanced:values.asset===values.liability+values.equity+net,
      ...q.rows[0]};
 }
 async aging(req:Request,cid:string){
   await this.core.allow(req,cid);
   const rows=await this.db.pool.query(`SELECT d.kind,d.document_no,d.due_date,d.grand_total::text,d.paid_total::text,
      (d.grand_total-d.paid_total)::text outstanding,c.name AS contact_name,
      GREATEST((CURRENT_DATE-d.due_date),0)::int overdue_days FROM business_documents d
      JOIN contacts c ON c.id=d.contact_id WHERE d.company_id=$1 AND d.status IN ('issued','partial')
      ORDER BY d.due_date ASC LIMIT 500`,[cid]);
   return rows.rows;
 }
 async bridge(req:Request,cid:string){
   await this.core.allow(req,cid);
   return (await this.db.pool.query(`SELECT id,provider,external_id,record_type,status,created_at
     FROM integration_staging WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100`,[cid])).rows;
 }
 async stage(req:Request,cid:string,b:any){
   const {user}=await this.core.allow(req,cid,true);
   const provider=checkKind(b?.provider,['wafeq','xero','erpnext','odoo','smacc','csv','other'],'المصدر');
   const externalId=nonempty(b?.externalId,'معرف المصدر',180);
   const kind=checkKind(b?.recordType,['invoice','bill','contact','account','journal'],'نوع السجل');
   ensure(b?.payload!==null&&typeof b?.payload==='object'&&!Array.isArray(b.payload),'البيانات تحتاج كائن JSON');
   const serialized=JSON.stringify(b.payload);ensure(serialized.length<=32000,'حجم البيانات كبير');
   return this.db.transaction(async c=>{
     const q=await c.query(`INSERT INTO integration_staging(company_id,provider,external_id,record_type,payload,created_by)
       VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,provider,external_id,record_type,status,created_at`,
       [cid,provider,externalId,kind,serialized,user.id]);
     await this.log(c,cid,user.id,'integration.staged',q.rows[0].id);return q.rows[0];
   });
 }
 async compliance(req:Request,cid:string){
   await this.core.allow(req,cid);
   return {provider:'ZATCA',integrationEnabled:false,productionReady:false,
     features:{ublXml:false,cryptographicStamp:false,qrPhase2:false,clearance:false,reporting:false,creditNotes:false},
     message:'هذا نموذج داخلي ولا يصدر فواتير إلكترونية معتمدة أو يرسلها للهيئة. يجب تنفيذ واختبار متطلبات ZATCA قبل الإنتاج.'};
 }
 async closePeriod(req:Request,cid:string,pid:string){
   const {user,role}=await this.core.allow(req,cid,true);
   if(role!=='owner') throw new ForbiddenException('إغلاق الفترة يتطلب المالك');
   ensure(isUuid(pid),'معرف الفترة غير صالح');
   return this.db.transaction(async c=>{
     const p=await c.query('SELECT * FROM fiscal_periods WHERE id=$1 AND company_id=$2 FOR UPDATE',[pid,cid]);
     if(!p.rowCount) throw new NotFoundException('الفترة غير موجودة');
     if(p.rows[0].status!=='open') throw new ConflictException('الفترة مغلقة');
     const drafts=await c.query(`SELECT COUNT(*)::int n FROM journal_entries WHERE company_id=$1 AND period_id=$2 AND status='draft'`,[cid,pid]);
     const docs=await c.query(`SELECT COUNT(*)::int n FROM business_documents WHERE company_id=$1 AND period_id=$2 AND status='draft'`,[cid,pid]);
     ensure(drafts.rows[0].n===0&&docs.rows[0].n===0,'توجد مسودات يجب معالجتها قبل إغلاق الفترة');
     await c.query("UPDATE fiscal_periods SET status='closed' WHERE id=$1 AND company_id=$2",[pid,cid]);
     await this.log(c,cid,user.id,'period.closed',pid);return {id:pid,status:'closed'};
   });
 }
}
@Controller('companies/:cid')
class CommerceController {
 constructor(private readonly s:CommerceService){}
 @Get('contacts') contacts(@Req() q:Request,@Param('cid') c:string){return this.s.contacts(q,c)}
 @Post('contacts') addContact(@Req() q:Request,@Param('cid') c:string,@Body() b:any){return this.s.addContact(q,c,b)}
 @Get('catalog') catalog(@Req() q:Request,@Param('cid') c:string){return this.s.catalog(q,c)}
 @Post('catalog') addCatalog(@Req() q:Request,@Param('cid') c:string,@Body() b:any){return this.s.addCatalog(q,c,b)}
 @Get('documents/:kind') docs(@Req() q:Request,@Param('cid') c:string,@Param('kind') k:string){return this.s.documents(q,c,k)}
 @Post('documents/:kind') addDoc(@Req() q:Request,@Param('cid') c:string,@Param('kind') k:string,@Body() b:any){return this.s.addDocument(q,c,k,b)}
 @Get('document/:id') doc(@Req() q:Request,@Param('cid') c:string,@Param('id') id:string){return this.s.document(q,c,id)}
 @Post('document/:id/issue') issue(@Req() q:Request,@Param('cid') c:string,@Param('id') id:string){return this.s.issueDocument(q,c,id)}
 @Post('document/:id/payments') payment(@Req() q:Request,@Param('cid') c:string,@Param('id') id:string,@Body() b:any){return this.s.receivePayment(q,c,id,b)}
 @Get('reports/financial') financial(@Req() q:Request,@Param('cid') c:string,@Query('asOf') a?:string){return this.s.financial(q,c,a)}
 @Get('reports/aging') aging(@Req() q:Request,@Param('cid') c:string){return this.s.aging(q,c)}
 @Get('integrations/staging') staging(@Req() q:Request,@Param('cid') c:string){return this.s.bridge(q,c)}
 @Post('integrations/staging') stage(@Req() q:Request,@Param('cid') c:string,@Body() b:any){return this.s.stage(q,c,b)}
 @Get('compliance/zatca') compliance(@Req() q:Request,@Param('cid') c:string){return this.s.compliance(q,c)}
 @Post('periods/:pid/close') close(@Req() q:Request,@Param('cid') c:string,@Param('pid') p:string){return this.s.closePeriod(q,c,p)}
}


@Injectable()
class ZatcaPreparationService {
  constructor(private readonly db:DataSource, private readonly core:JawaherService) {}
  private async owner(req:Request,cid:string) {
    const access=await this.core.allow(req,cid,true);
    if(access.role!=='owner') throw new ForbiddenException('تهيئة هوية زاتكا والإرسال التجريبي متاحان لمالك المنشأة فقط');
    return access;
  }
  private profileRecord(row:any) {
    if(!row) return null;
    return {legalName:row.legal_name,vatNumber:row.vat_number,crNumber:row.cr_number||'',
      buildingNumber:row.building_number,street:row.street,district:row.district,
      city:row.city,postalCode:row.postal_code,countryCode:row.country_code,deviceLabel:row.device_label};
  }
  async profile(req:Request,cid:string){
    await this.core.allow(req,cid);
    const r=await this.db.pool.query('SELECT * FROM zatca_profiles WHERE company_id=$1',[cid]);
    const profile=this.profileRecord(r.rows[0]);
    return {profile,preflightIssues:profile?validateProfile(profile as any):['لم يكتمل الملف الضريبي'],
      simulationConfigured:sandboxAvailable(cid),productionConnected:false,
      simulationBaseUrl:ZATCA_SIM_BASE,
      status:'not_certified',
      outstanding:[
        'إتمام UBL XML 2.1 وفق قواعد ZATCA وربط المصدر المحاسبي',
        'التجزئة والتوقيع الرقمي الصحيح والسلسلة وQR باستخدام أدوات تم التحقق منها',
        'CSR وCompliance CSID وPCSID لكل وحدة فوترة وبيئة',
        'اختبارات الامتثال والفواتير والإشعارات الدائنة والمدينة مع SDK والمحاكاة',
        'اختبار أمن وتشغيل ومراجعة محاسبية وضريبية قبل تفعيل الإنتاج'
      ]};
  }
  async saveProfile(req:Request,cid:string,b:any){
    const {user}=await this.owner(req,cid);
    const field=(key:string,max:number)=>nonempty(b?.[key],key,max);
    const profile={legalName:field('legalName',180),vatNumber:field('vatNumber',15),
      crNumber: typeof b?.crNumber==='string'?b.crNumber.trim().slice(0,30):'',
      buildingNumber:field('buildingNumber',4),street:field('street',180),district:field('district',180),
      city:field('city',120),postalCode:field('postalCode',5),countryCode:field('countryCode',2),deviceLabel:field('deviceLabel',120)};
    const issues=validateProfile(profile as any);
    ensure(issues.length===0,issues.join('؛ '));
    await this.db.transaction(async c=>{
      await c.query(`INSERT INTO zatca_profiles(company_id,legal_name,vat_number,cr_number,building_number,street,district,city,postal_code,country_code,device_label,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(company_id) DO UPDATE SET legal_name=EXCLUDED.legal_name,vat_number=EXCLUDED.vat_number,cr_number=EXCLUDED.cr_number,
      building_number=EXCLUDED.building_number,street=EXCLUDED.street,district=EXCLUDED.district,city=EXCLUDED.city,
      postal_code=EXCLUDED.postal_code,country_code=EXCLUDED.country_code,device_label=EXCLUDED.device_label,
      updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [cid,profile.legalName,profile.vatNumber,profile.crNumber||null,profile.buildingNumber,profile.street,
       profile.district,profile.city,profile.postalCode,profile.countryCode,profile.deviceLabel,user.id]);
      await c.query(`INSERT INTO audit_events(company_id,actor_id,event,metadata) VALUES($1,$2,'zatca.profile_updated',$3::jsonb)`,
        [cid,user.id,JSON.stringify({deviceLabel:profile.deviceLabel})]);
    });
    return {saved:true,profile,productionConnected:false};
  }
  async docs(req:Request,cid:string){
    await this.core.allow(req,cid);
    const r=await this.db.pool.query(`SELECT d.id,d.document_no,d.kind,d.status,d.issue_date,d.grand_total,
      COALESCE(z.invoice_category,'') AS invoice_category,
      COALESCE(ct.name,'') AS customer_name
      FROM business_documents d LEFT JOIN contacts ct ON ct.id=d.contact_id AND ct.company_id=d.company_id
      LEFT JOIN zatca_document_preparations z ON z.company_id=d.company_id AND z.document_id=d.id
      WHERE d.company_id=$1 AND d.kind='sale' ORDER BY d.created_at DESC LIMIT 80`,[cid]);
    return r.rows;
  }
  async assignCategory(req:Request,cid:string,docId:string,b:any){
    const {user}=await this.core.allow(req,cid,true);
    ensure(isUuid(docId),'معرف المستند غير صالح');
    const category=b?.invoiceCategory;
    ensure(category==='standard'||category==='simplified','نوع الفاتورة: standard أو simplified');
    return this.db.transaction(async c=>{
      const r=await c.query(`SELECT id FROM business_documents WHERE company_id=$1 AND id=$2 AND kind='sale'`,[cid,docId]);
      if(!r.rowCount) throw new NotFoundException('فاتورة مبيعات غير موجودة');
      await c.query(`INSERT INTO zatca_document_preparations(company_id,document_id,invoice_category,prepared_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(company_id,document_id) DO UPDATE SET
        invoice_category=EXCLUDED.invoice_category,prepared_by=EXCLUDED.prepared_by,prepared_at=now()`,[cid,docId,category,user.id]);
      await c.query(`INSERT INTO audit_events(company_id,actor_id,event,object_id,metadata)
        VALUES($1,$2,'zatca.category_assigned',$3,$4::jsonb)`,[cid,user.id,docId,JSON.stringify({category})]);
      return {documentId:docId,invoiceCategory:category};
    });
  }
  private async context(cid:string,docId:string) {
    ensure(isUuid(docId),'معرف المستند غير صالح');
    const q=await this.db.pool.query(`SELECT d.id,d.kind,d.status,d.issue_date,d.subtotal,d.vat_total,
        c.name AS contact_name,c.tax_number AS contact_tax_number,
        z.invoice_category,
        (SELECT COUNT(*)::int FROM document_lines l WHERE l.company_id=d.company_id AND l.document_id=d.id) AS line_count,
        (SELECT COUNT(*)::int FROM document_lines l WHERE l.company_id=d.company_id AND l.document_id=d.id AND l.tax_rate=0) AS unsupported_rates
      FROM business_documents d JOIN contacts c ON c.id=d.contact_id AND c.company_id=d.company_id
      LEFT JOIN zatca_document_preparations z ON z.company_id=d.company_id AND z.document_id=d.id
      WHERE d.company_id=$1 AND d.id=$2`,[cid,docId]);
    if(!q.rowCount) throw new NotFoundException('المستند غير موجود');
    const p=await this.db.pool.query('SELECT * FROM zatca_profiles WHERE company_id=$1',[cid]);
    const d=q.rows[0];
    const category=d.invoice_category as 'standard'|'simplified'|null;
    const issues=preflightDocument(this.profileRecord(p.rows[0]),{
      kind:d.kind,status:d.status,invoiceCategory:category,contactName:d.contact_name,
      contactTaxNumber:d.contact_tax_number,issueDate:d.issue_date?String(d.issue_date):'',
      subtotal:String(d.subtotal),vatTotal:String(d.vat_total),lineCount:d.line_count,
      unsupportedRates:d.unsupported_rates});
    return {documentId:docId,invoiceCategory:category,issues,documentStatus:d.status,profilePresent:!!p.rowCount};
  }
  async documentPreflight(req:Request,cid:string,docId:string){
    await this.core.allow(req,cid);
    const result=await this.context(cid,docId);
    return {...result,readyForSubmission:false,productionReady:false,
      note:'هذه فحوص داخلية أولية، وليست تحققًا أو اعتمادًا من ZATCA. يتطلب الإرسال النهائي XML موقعًا وSDK واختبارات.'};
  }
  async history(req:Request,cid:string) {
    await this.core.allow(req,cid);
    const q=await this.db.pool.query(`SELECT a.id,a.document_id,a.operation,a.invoice_uuid,a.http_status,a.outcome,a.created_at
      FROM zatca_simulation_attempts a WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT 50`,[cid]);
    return q.rows;
  }
  async simulate(req:Request,cid:string,docId:string,kind:string,b:any){
    const {user}=await this.owner(req,cid);
    if(!sandboxAvailable(cid)) throw new ForbiddenException('المحاكاة مغلقة. فعليها بمفاتيح ZATCA التجريبية لهذه المنشأة فقط.');
    const ctx=await this.context(cid,docId);
    ensure(ctx.invoiceCategory==='standard'||ctx.invoiceCategory==='simplified','يجب تحديد نوع الفاتورة');
    ensure(ctx.documentStatus!=='draft','لا يمكن إرسال مسودة داخلية');
    try { validateSubmissionKind(kind,ctx.invoiceCategory); }
    catch(e) { throw new BadRequestException((e as Error).message); }
    ensure(b?.confirmedSdkValidation===true,'يجب التأكيد أن المستند وُقّع وفُحص مسبقًا باستخدام ZATCA SDK في بيئة المحاكاة');
    let envelope;
    try { envelope=assertSignedEnvelope(b?.envelope); }
    catch(e){throw new BadRequestException((e as Error).message);}
    // No outbound operation to production is implemented. Explicit simulation only.
    let result;
    try{result=await callZatcaSimulation(cid,kind as 'clearance'|'reporting'|'complianceInvoices',envelope);}
    catch { throw new BadRequestException('تعذر الاتصال ببيئة المحاكاة؛ راجعي اتصال الشبكة والبيانات التجريبية دون تكرار الإرسال عشوائيًا'); }
    const response=result.body as any;
    const declared=String(response?.clearanceStatus||response?.reportingStatus||'').toLowerCase();
    const outcome=result.httpStatus>=400?'rejected':declared.includes('warn')?'warning':
      ['cleared','reported'].includes(declared)?'accepted':'unknown';
    await this.db.transaction(async c=>{
      await c.query(`INSERT INTO zatca_simulation_attempts(company_id,document_id,operation,invoice_uuid,envelope_fingerprint,http_status,outcome,requested_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[cid,docId,kind,envelope.uuid,envelopeFingerprint(envelope),result.httpStatus,outcome,user.id]);
      await c.query(`INSERT INTO audit_events(company_id,actor_id,event,object_id,metadata)
       VALUES($1,$2,'zatca.simulation_request',$3,$4::jsonb)`,[cid,user.id,docId,JSON.stringify({operation:kind,httpStatus:result.httpStatus,outcome})]);
    });
    return {environment:'simulation',httpStatus:result.httpStatus,outcome,
      response:result.body,productionConnected:false,note:'لا يعد قبول المحاكاة اعتمادًا ضريبيًا أو تصريحًا باستخدام الإنتاج.'};
  }
}
@Controller('companies/:cid/zatca')
class ZatcaPreparationController {
  constructor(private readonly svc:ZatcaPreparationService) {}
  @Get('status') status(@Req() q:Request,@Param('cid') c:string){return this.svc.profile(q,c);}
  @Post('profile') save(@Req() q:Request,@Param('cid') c:string,@Body() b:any){return this.svc.saveProfile(q,c,b);}
  @Get('documents') docs(@Req() q:Request,@Param('cid') c:string){return this.svc.docs(q,c);}
  @Post('documents/:id/category') category(@Req() q:Request,@Param('cid') c:string,@Param('id') id:string,@Body() b:any){return this.svc.assignCategory(q,c,id,b);}
  @Get('documents/:id/preflight') check(@Req() q:Request,@Param('cid') c:string,@Param('id') id:string){return this.svc.documentPreflight(q,c,id);}
  @Get('simulation/history') history(@Req() q:Request,@Param('cid') c:string){return this.svc.history(q,c);}
  @Post('documents/:id/simulation/:operation') simulate(@Req() q:Request,@Param('cid') c:string,@Param('id') id:string,@Param('operation') op:string,@Body() b:any){return this.svc.simulate(q,c,id,op,b);}
}
@Module({controllers:[JawaherController,CommerceController,ZatcaPreparationController],providers:[DataSource,JawaherService,CommerceService,ZatcaPreparationService,AuthRateLimiter]})
export class AppModule {}
