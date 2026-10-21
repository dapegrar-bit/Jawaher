'use client';
import CommerceWorkspace from './commerce';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Company = {id:string;name:string;currency:string;role:string};
type Account = {id:string;code:string;name:string;kind:string;active:boolean;postable:boolean};
type Period = {id:string;title:string;starts_on:string;ends_on:string;status:string};
type Journal = {id:string;entry_date:string;memo:string;status:string;total:string;created_at:string};
type TrialRow = {id:string;code:string;name:string;kind:string;debitBalance:string;creditBalance:string};
type Trial = {asOf:string;rows:TrialRow[];totals:{debit:string;credit:string}};
type Audit = {event:string;created_at:string;email:string};
type Tab = 'dashboard' | 'accounts' | 'journals' | 'trial' | 'audit' | 'contacts' | 'catalog' | 'sales' | 'purchases' | 'financial' | 'aging' | 'bridge' | 'insights' | 'compliance' | 'settings';
type Line = {accountId:string;debit:string;credit:string};
const API = '/backend';
const money = (v:string|number|undefined) => new Intl.NumberFormat('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
const today = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
const AR_KINDS:Record<string,string>={asset:'أصول',liability:'التزامات',equity:'حقوق ملكية',income:'إيرادات',expense:'مصروفات'};
const NAV:{key:Tab;icon:string;label:string;detail:string}[] = [
  {key:'dashboard',icon:'◫',label:'الرئيسية',detail:'ملخص المنشأة'},
  {key:'accounts',icon:'▦',label:'دليل الحسابات',detail:'شجرة الحسابات'},
  {key:'journals',icon:'▤',label:'القيود اليومية',detail:'مسودات وترحيل'},
  {key:'trial',icon:'▥',label:'ميزان المراجعة',detail:'التقارير المالية'},
  {key:'audit',icon:'◷',label:'سجل التدقيق',detail:'الأحداث المحاسبية'},
  {key:'contacts',icon:'♙',label:'العملاء والموردون',detail:'جهات الاتصال'},
  {key:'catalog',icon:'▧',label:'المنتجات والخدمات',detail:'كتالوج الأسعار'},
  {key:'sales',icon:'↗',label:'فواتير المبيعات',detail:'المسودات والتحصيل'},
  {key:'purchases',icon:'↙',label:'فواتير المشتريات',detail:'الموردون والسداد'},
  {key:'financial',icon:'▥',label:'التقارير المالية',detail:'الأداء المالي'},
  {key:'aging',icon:'◴',label:'أعمار الذمم',detail:'الديون والاستحقاقات'},
  {key:'bridge',icon:'⇄',label:'جواهر جسر',detail:'التكاملات'},
  {key:'insights',icon:'✧',label:'جواهر بصيرة',detail:'مؤشرات وقواعد تحليلية'},
  {key:'compliance',icon:'◇',label:'الامتثال والضريبة',detail:'حالة ربط ZATCA'},
  {key:'settings',icon:'⚙',label:'الفترات المالية',detail:'الإعدادات المالية'}
];
async function request<T=any>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(`${API}${path}`,{
    ...init, credentials:'include', cache:'no-store',
    headers:{'Content-Type':'application/json','X-Jawaher-Client':'web',...(init.headers||{})}
  });
  const json=await response.json().catch(()=>({message:'تعذر قراءة استجابة الخادم'}));
  if(!response.ok) throw new Error(Array.isArray(json.message)?json.message.join(' - '):json.message||`HTTP ${response.status}`);
  return json;
}
function SmallIcon({children}:{children:React.ReactNode}){return <span aria-hidden="true" className="nav-icon">{children}</span>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
function Empty({title,description}:{title:string;description:string}){return <div className="empty"><div className="empty-graphic">▥</div><b>{title}</b><p>{description}</p></div>}

export default function Home(){
  const [loading,setLoading]=useState(true),[user,setUser]=useState<{id:string;email:string}|null>(null);
  const [authMode,setAuthMode]=useState<'register'|'login'>('register');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[companyName,setCompanyName]=useState('');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [companies,setCompanies]=useState<Company[]>([]),[company,setCompany]=useState<Company|null>(null),[tab,setTab]=useState<Tab>('dashboard');
  const [accounts,setAccounts]=useState<Account[]>([]),[periods,setPeriods]=useState<Period[]>([]);
  const [journals,setJournals]=useState<Journal[]>([]),[trial,setTrial]=useState<Trial|null>(null),[audit,setAudit]=useState<Audit[]>([]);
  const [dashboard,setDashboard]=useState({accounts:0,posted_journals:0,draft_journals:0});
  const [showAccount,setShowAccount]=useState(false),[showJournal,setShowJournal]=useState(false);
  const [acctCode,setAcctCode]=useState(''),[acctName,setAcctName]=useState(''),[acctKind,setAcctKind]=useState('expense');
  const [journalMemo,setJournalMemo]=useState(''),[journalDate,setJournalDate]=useState(today());
  const [periodId,setPeriodId]=useState(''),[lines,setLines]=useState<Line[]>([{accountId:'',debit:'',credit:''},{accountId:'',debit:'',credit:''}]);
  const [asOf,setAsOf]=useState(today());
  const fetchCompanies=useCallback(async()=>{
    const c=await request<Company[]>('/companies');setCompanies(c);
    setCompany(old=>c.find(item=>item.id===old?.id)||c[0]||null);return c;
  },[]);
  useEffect(()=>{
    (async()=>{try{const u=await request('/auth/me');setUser(u);await fetchCompanies();}catch{}finally{setLoading(false)}})();
  },[fetchCompanies]);
  const refresh=useCallback(async(cid:string)=>{
    const base=`/companies/${cid}`;
    try {
      const [a,p,j,t,d,au]=await Promise.all([
        request<Account[]>(`${base}/accounts`),request<Period[]>(`${base}/periods`),
        request<Journal[]>(`${base}/journals`),request<Trial>(`${base}/reports/trial-balance?asOf=${asOf}`),
        request<typeof dashboard>(`${base}/dashboard`),request<Audit[]>(`${base}/audit`)
      ]);
      setAccounts(a);setPeriods(p);setJournals(j);setTrial(t);setDashboard(d);setAudit(au);
      setPeriodId(old=>p.some(x=>x.id===old)?old:(p.find(x=>x.status==='open')?.id||''));
    }catch(e){setNotice((e as Error).message)}
  },[asOf]);
  useEffect(()=>{if(company)refresh(company.id);},[company,refresh]);
  async function authenticate(e:FormEvent){
    e.preventDefault();setBusy(true);setNotice('');
    try{
      const path=authMode==='register'?'/auth/register':'/auth/login';
      const result=await request(path,{method:'POST',body:JSON.stringify({email,password,...(authMode==='register'?{companyName}:{})})});
      setUser(result.user);await fetchCompanies();setPassword('');setTab('dashboard');
    }catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
  }
  async function signOut(){
    try{await request('/auth/logout',{method:'POST',body:'{}'})}catch{};
    setUser(null);setCompany(null);setCompanies([]);setNotice('');setAuthMode('login');
  }
  async function createAccount(e:FormEvent){
    e.preventDefault();if(!company)return;
    setBusy(true);setNotice('');try{
      await request(`/companies/${company.id}/accounts`,{method:'POST',body:JSON.stringify({code:acctCode,name:acctName,kind:acctKind})});
      setAcctCode('');setAcctName('');setShowAccount(false);await refresh(company.id);
      setNotice('تم إنشاء الحساب بنجاح.');
    }catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
  }
  async function createJournal(e:FormEvent){
    e.preventDefault();if(!company)return;
    const normalized=lines.map(l=>({...l,debit:l.debit||'0',credit:l.credit||'0'}));
    setBusy(true);setNotice('');try{
      const result=await request<{id:string}>(`/companies/${company.id}/journals`,{method:'POST',
        body:JSON.stringify({memo:journalMemo,entryDate:journalDate,periodId,
        lines:normalized,idempotencyKey:crypto.randomUUID()})});
      setShowJournal(false);setJournalMemo('');setLines([{accountId:'',debit:'',credit:''},{accountId:'',debit:'',credit:''}]);
      await refresh(company.id);setNotice(`تم حفظ مسودة القيد بنجاح (${result.id.slice(0,8)}).`);
    }catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
  }
  async function postJournal(id:string){
    if(!company||!window.confirm('ترحيل القيد عملية نهائية في هذه النسخة. هل تريد المتابعة؟'))return;
    setBusy(true);setNotice('');try{
      await request(`/companies/${company.id}/journals/${id}/post`,{method:'POST',body:'{}'});
      await refresh(company.id);setNotice('تم ترحيل القيد بنجاح.');
    }catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
  }
  const canWrite=company?.role!=='viewer';
  const currentTitle=NAV.find(x=>x.key===tab)?.label;
  const activeAccounts=useMemo(()=>accounts.filter(a=>a.active&&a.postable),[accounts]);
  if(loading)return <div className="loading-screen">جارٍ تهيئة جواهر ميزان...</div>;
  if(!user)return <div className="auth-page">
    <div className="auth-side">
      <div className="brand mark"><span className="brand-symbol">ج</span><span><b>جواهر ميزان</b><small>JAWAHER MIZAN</small></span></div>
      <div className="auth-message"><span className="tag">نسخة موسعة تجريبية · 1.0</span><h1>حسابات أكثر وضوحًا.<br/><em>قرارات أكثر ثقة.</em></h1>
      <p>ابدئي بإدارة منشأتك، ودليل حساباتك، والقيود اليومية، وميزان المراجعة من مساحة عمل عربية متكاملة.</p>
      <div className="auth-features"><span>◈ قيود مزدوجة دقيقة</span><span>◈ إدارة مستخدمين وصلاحيات</span><span>◈ تقارير مالية مباشرة</span></div></div>
      <div className="brand-bottom">منتج تجريبي للتطوير والاختبار، غير مخصص للاستخدام الضريبي أو المالي الفعلي.</div>
    </div>
    <div className="auth-panel"><form className="auth-form" onSubmit={authenticate}>
      <div className="mobile-brand"><b>جواهر ميزان</b></div>
      <div className="eyebrow">ابدئي مع جواهر</div><h2>{authMode==='register'?'أنشئي مساحة عملك':'مرحبًا بعودتك'}</h2>
      <p>لوحة محاسبية عربية، مصممة للبساطة والدقة.</p>
      {authMode==='register'&&<Field label="اسم المنشأة"><input required placeholder="مثال: شركة جواهر للخدمات" value={companyName} maxLength={180} onChange={e=>setCompanyName(e.target.value)}/></Field>}
      <Field label="البريد الإلكتروني"><input dir="ltr" type="email" required placeholder="name@company.com" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
      <Field label="كلمة المرور"><input dir="ltr" type="password" required minLength={authMode==='register'?12:1} placeholder={authMode==='register'?'12 حرفًا على الأقل':'كلمة المرور'} value={password} onChange={e=>setPassword(e.target.value)}/></Field>
      {notice&&<p className="notice error" role="alert">{notice}</p>}
      <button className="primary wide" disabled={busy}>{busy?'جارٍ المعالجة...':authMode==='register'?'إنشاء الحساب والمنشأة':'تسجيل الدخول'} <span>←</span></button>
      <div className="switch-auth">{authMode==='register'?'لديك حساب بالفعل؟':'ليس لديك حساب؟'} <button type="button" className="link-btn" onClick={()=>{setAuthMode(authMode==='register'?'login':'register');setNotice('')}}>{authMode==='register'?'تسجيل الدخول':'إنشاء حساب'}</button></div>
      <small className="auth-disclaimer">بيانات تدريبية فقط · لا تستخدم بيانات أو فواتير عملاء حقيقية في بيئة التطوير.</small>
    </form></div>
  </div>;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand sidebar-brand"><span className="brand-symbol">ج</span><span><b>جواهر ميزان</b><small>JAWAHER MIZAN</small></span></div>
      <div className="sidebar-label">مساحة العمل</div>
      <div className="company-switch"><div className="company-logo">◈</div><div className="company-text"><b>{company?.name||'المنشأة'}</b><small>{company?.role==='owner'?'مدير المنشأة':company?.role==='accountant'?'محاسب':'قراءة فقط'}</small></div></div>
      <div className="sidebar-label">الإدارة المالية</div>
      <nav aria-label="القائمة الرئيسية">{NAV.map(n=><button type="button" key={n.key} className={`nav-link ${tab===n.key?'active':''}`} onClick={()=>{setTab(n.key);setNotice('')}}><SmallIcon>{n.icon}</SmallIcon>{n.label}{tab===n.key&&<span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-support"><span>✦</span><b>جواهر بصيرة</b><small>مساعد الذكاء الاصطناعي · قريبًا</small></div><button className="logout" onClick={signOut}>⇥ تسجيل الخروج</button></div>
    </aside>
    <div className="content"><header className="topbar"><div className="breadcrumb"><span>جواهر ميزان</span><span className="separator">/</span><b>{currentTitle}</b></div><div className="top-actions"><span className="env-label">بيئة تطوير</span><span className="account-pill">{user.email.slice(0,1).toUpperCase()}</span></div></header>
      <main className="main-content"><div className="page-intro"><div><div className="eyebrow">التحكم والإدارة</div><h1>{tab==='dashboard'?`أهلًا بك في ${company?.name||'جواهر'}`:currentTitle}</h1>
      <p>{NAV.find(x=>x.key===tab)?.detail} · البيانات في قاعدة المنشأة الخاصة بك.</p></div><div className="header-mark">◈</div></div>
      <div className="development-banner"><span className="warn-icon">!</span><span><b>نسخة أولية للتطوير والاختبار</b> — تعمل كوحدات محاسبة تجريبية، لكنها ليست معتمدة للعمليات المالية الفعلية أو التكامل الضريبي ZATCA.</span></div>
      {notice&&<div className={`notice ${notice.includes('تم ')?'success':'error'}`} role="status"><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}
      {tab==='dashboard'&&<>
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-header"><span>الحسابات المسجلة</span><span className="stat-icon">▦</span></div><div className="stat-value">{dashboard.accounts}</div><small>حسابًا في دليل المنشأة</small></div>
          <div className="stat-card"><div className="stat-header"><span>القيود المرحلة</span><span className="stat-icon">✓</span></div><div className="stat-value">{dashboard.posted_journals}</div><small>عمليات معتمدة</small></div>
          <div className="stat-card"><div className="stat-header"><span>قيود تنتظر الترحيل</span><span className="stat-icon">◷</span></div><div className="stat-value">{dashboard.draft_journals}</div><small>مسودات قيد المراجعة</small></div>
          <div className="stat-card featured"><div className="stat-header"><span>العملة الأساسية</span><span className="stat-icon">ر.س</span></div><div className="stat-value" style={{fontSize:29}}>ريال سعودي</div><small>تجربة SAR فقط</small></div>
        </div>
        <div className="dashboard-panels"><section className="panel"><div className="panel-heading"><div><h3>آخر القيود</h3><p>آخر العمليات في دفتر اليومية</p></div><button className="text-action" onClick={()=>setTab('journals')}>عرض الكل ←</button></div>
          {journals.length?<div className="compact-list">{journals.slice(0,5).map(j=><div className="compact-item" key={j.id}><div className="round-icon">▤</div><div className="item-description"><b>{j.memo}</b><small>{j.entry_date}</small></div><span className={`status ${j.status==='posted'?'posted':'draft'}`}>{j.status==='posted'?'مرحّل':'مسودة'}</span><strong>{money(j.total)} <small>ر.س</small></strong></div>)}</div>:<Empty title="لا توجد قيود بعد" description="أنشئي قيدك الأول من صفحة القيود اليومية."/>}
        </section><section className="panel quick-panel"><div className="panel-heading"><div><h3>إجراءات سريعة</h3><p>ابدئي العمل بخطوة واحدة</p></div></div>
        <button className="quick-link" onClick={()=>{setTab('journals');setShowJournal(true)}}><span className="quick-icon">＋</span><span><b>إضافة قيد يومية</b><small>إنشاء قيد محاسبي متوازن</small></span><i>←</i></button>
        <button className="quick-link" onClick={()=>{setTab('accounts');setShowAccount(true)}}><span className="quick-icon">▦</span><span><b>حساب جديد</b><small>إضافة حساب إلى الدليل</small></span><i>←</i></button>
        <button className="quick-link" onClick={()=>setTab('trial')}><span className="quick-icon">▥</span><span><b>ميزان المراجعة</b><small>عرض أرصدة الحسابات المرحلة</small></span><i>←</i></button>
        </section></div>
      </>}
      {tab==='accounts'&&<section className="panel full-panel"><div className="panel-heading"><div><h3>دليل الحسابات</h3><p>حسابات المنشأة الأساسية والإضافية</p></div>{canWrite&&<button className="primary" onClick={()=>setShowAccount(x=>!x)}>{showAccount?'إغلاق':'＋ إضافة حساب'}</button>}</div>
      {showAccount&&<form onSubmit={createAccount} className="inline-form"><Field label="رقم الحساب"><input required value={acctCode} maxLength={24} onChange={e=>setAcctCode(e.target.value)} placeholder="مثال: 5300"/></Field><Field label="اسم الحساب"><input required value={acctName} maxLength={180} onChange={e=>setAcctName(e.target.value)} placeholder="مثال: مصروف صيانة"/></Field><Field label="التصنيف"><select value={acctKind} onChange={e=>setAcctKind(e.target.value)}>{Object.entries(AR_KINDS).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></Field><button disabled={busy} className="primary">حفظ الحساب</button></form>}
      <div className="table-wrap"><table><thead><tr><th>رمز الحساب</th><th>اسم الحساب</th><th>التصنيف</th><th>الحالة</th></tr></thead><tbody>{accounts.map(a=><tr key={a.id}><td><span className="code-pill">{a.code}</span></td><td><b>{a.name}</b></td><td>{AR_KINDS[a.kind]}</td><td><span className="status posted">نشط</span></td></tr>)}</tbody></table></div></section>}
      {tab==='journals'&&<section className="panel full-panel"><div className="panel-heading"><div><h3>دفتر القيود اليومية</h3><p>الترحيل يثبت القيد ولا يسمح بتعديله في هذه النسخة</p></div>{canWrite&&<button className="primary" onClick={()=>setShowJournal(x=>!x)}>{showJournal?'إغلاق':'＋ إنشاء قيد'}</button>}</div>
      {showJournal&&<form className="journal-form" onSubmit={createJournal}><div className="form-row"><Field label="بيان القيد"><input required value={journalMemo} maxLength={500} onChange={e=>setJournalMemo(e.target.value)} placeholder="مثال: إيداع رأس المال"/></Field><Field label="تاريخ القيد"><input type="date" required value={journalDate} onChange={e=>setJournalDate(e.target.value)}/></Field><Field label="الفترة المالية"><select required value={periodId} onChange={e=>setPeriodId(e.target.value)}>{periods.filter(p=>p.status==='open').map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></Field></div>
      <div className="journal-lines"><div className="journal-line heading"><span>الحساب</span><span>مدين (ر.س)</span><span>دائن (ر.س)</span><span></span></div>{lines.map((l,i)=><div key={i} className="journal-line"><select required aria-label={`الحساب للسطر ${i+1}`} value={l.accountId} onChange={e=>setLines(old=>old.map((x,j)=>j===i?{...x,accountId:e.target.value}:x))}><option value="">اختاري الحساب</option>{activeAccounts.map(a=><option value={a.id} key={a.id}>{a.code} — {a.name}</option>)}</select><input aria-label={`المدين للسطر ${i+1}`} inputMode="decimal" placeholder="0.00" value={l.debit} onChange={e=>setLines(old=>old.map((x,j)=>j===i?{...x,debit:e.target.value}:x))}/><input aria-label={`الدائن للسطر ${i+1}`} inputMode="decimal" placeholder="0.00" value={l.credit} onChange={e=>setLines(old=>old.map((x,j)=>j===i?{...x,credit:e.target.value}:x))}/><button type="button" aria-label="حذف السطر" disabled={lines.length<=2} onClick={()=>setLines(old=>old.filter((_,j)=>j!==i))} className="remove">×</button></div>)}</div>
      <div className="form-actions"><button type="button" className="secondary" onClick={()=>setLines(old=>[...old,{accountId:'',debit:'',credit:''}])}>＋ إضافة سطر</button><button type="submit" disabled={busy} className="primary">{busy?'جارٍ الحفظ...':'حفظ كمسودة'}</button></div>
      <small className="helptext">أدخلي مبلغًا في المدين أو الدائن بكل سطر، ويجب أن يكون مجموع الطرفين متساويًا. يعتمد الخادم الحساب الدقيق.</small></form>}
      {journals.length?<div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>وصف القيد</th><th>الإجمالي</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{journals.map(j=><tr key={j.id}><td>{j.entry_date}</td><td><b>{j.memo}</b></td><td>{money(j.total)} ر.س</td><td><span className={`status ${j.status==='posted'?'posted':'draft'}`}>{j.status==='posted'?'مرحّل':'مسودة'}</span></td><td>{j.status==='draft'&&canWrite?<button className="small-primary" disabled={busy} onClick={()=>postJournal(j.id)}>ترحيل القيد</button>:<span className="muted">—</span>}</td></tr>)}</tbody></table></div>:<Empty title="لا توجد قيود مسجلة" description="اضغطي إنشاء قيد لإضافة أول قيد يومية إلى منشأتك."/>}</section>}
      {tab==='trial'&&<section className="panel full-panel"><div className="panel-heading"><div><h3>ميزان المراجعة</h3><p>أرصدة القيود المرحلة حتى التاريخ المحدد</p></div><div className="date-filter"><label htmlFor="as-of">حتى تاريخ</label><input id="as-of" type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></div></div>
      <div className="table-wrap"><table><thead><tr><th>الحساب</th><th>اسم الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>{trial?.rows.map(r=><tr key={r.id}><td className="code-col">{r.code}</td><td>{r.name}</td><td>{money(r.debitBalance)}</td><td>{money(r.creditBalance)}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>الإجمالي</td><td>{money(trial?.totals.debit)}</td><td>{money(trial?.totals.credit)}</td></tr></tfoot></table></div>
      <div className="report-note">هذا التقرير تجريبي وبعملة الريال فقط. رصيد كل حساب هو صافي المدين والدائن حتى التاريخ.</div></section>}
      {tab==='audit'&&<section className="panel full-panel"><div className="panel-heading"><div><h3>سجل التدقيق</h3><p>تاريخ إنشاء الحسابات والقيود والترحيل</p></div><span className="env-label">آخر 50 حدثًا</span></div>
      {audit.length?<div className="audit-list">{audit.map((a,i)=><div key={i} className="audit-row"><span className="audit-bullet">●</span><div><b>{a.event==='journal.posted'?'ترحيل قيد يومية':a.event==='journal.drafted'?'إنشاء مسودة قيد':a.event==='account.created'?'إضافة حساب':a.event==='company.created'?'إنشاء منشأة':a.event}</b><small>{a.email}</small></div><time>{new Date(a.created_at).toLocaleString('ar-SA')}</time></div>)}</div>:<Empty title="لا توجد أحداث" description="ستظهر العمليات المالية المسجلة هنا."/>}</section>}
      {company&&(['contacts','catalog','sales','purchases','financial','aging','bridge','insights','compliance','settings'] as Tab[]).includes(tab)&&<CommerceWorkspace key={company.id+':'+tab} companyId={company.id} canWrite={canWrite} tab={tab as any} isOwner={company?.role==='owner'} notify={setNotice}/>}
      <footer className="app-footer">© جواهر ميزان · إصدار Starter 1.0 · بنية تجريبية غير مخصصة للعمليات المالية الحقيقية</footer>
      </main></div>
  </div>;
}
