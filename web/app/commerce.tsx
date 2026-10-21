'use client';
import {FormEvent,useCallback,useEffect,useMemo,useState} from 'react';
import ZatcaWorkspace from './ZatcaWorkspace';

type Contact={id:string;name:string;kind:string;email:string|null;phone:string|null;tax_number:string|null};
type Item={id:string;name:string;sku:string|null;unit:string;price:string;kind:string};
type Doc={id:string;document_no:number;kind:string;contact_name:string;contact_id:string;status:string;grand_total:string;paid_total:string;issue_date:string;due_date:string;zatca_status:string};
type Fin={asOf:string;currency:string;income:string;expenses:string;netProfit:string;assets:string;liabilities:string;equity:string;retainedEarnings:string;equationBalanced:boolean;contacts:number;items:number;sales:number;purchases:number;receivables:string;payables:string};
type Aging={kind:string;document_no:number;due_date:string;outstanding:string;contact_name:string;overdue_days:number};
type Staged={id:string;provider:string;external_id:string;record_type:string;status:string;created_at:string};
type Period={id:string;title:string;status:string;starts_on:string;ends_on:string};
type View='contacts'|'catalog'|'sales'|'purchases'|'financial'|'aging'|'bridge'|'compliance'|'settings'|'insights';
type Line={description:string;quantity:number;unitPrice:string;taxRate:number};
const API='/backend';
const money=(v:any)=>new Intl.NumberFormat('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
const dateToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
const statusName=(s:string)=>({draft:'مسودة',issued:'صادرة',partial:'مدفوع جزئيًا',paid:'مدفوعة',staged:'بانتظار المراجعة'} as Record<string,string>)[s]||s;
const kindName=(s:string)=>({customer:'عميل',supplier:'مورد',both:'عميل ومورد',service:'خدمة',product:'منتج'} as Record<string,string>)[s]||s;
async function call<T=any>(path:string,init:RequestInit={}):Promise<T>{
 const r=await fetch(API+path,{...init,credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json','X-Jawaher-Client':'web',...(init.headers||{})}});
 const json=await r.json().catch(()=>({message:'تعذر قراءة استجابة الخادم'}));
 if(!r.ok)throw new Error(Array.isArray(json.message)?json.message.join(' / '):json.message||`HTTP ${r.status}`);
 return json as T;
}
const blankLine=():Line=>({description:'',quantity:1,unitPrice:'0.00',taxRate:15});
function Labeled({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
function moneyValue(v:string|undefined){return Number(v||0)}
export default function CommerceWorkspace({companyId,canWrite,tab,notify,isOwner=false}:{companyId:string;canWrite:boolean;isOwner?:boolean;tab:View;notify:(s:string)=>void}){
 const root=`/companies/${companyId}`;
 const [contacts,setContacts]=useState<Contact[]>([]),[catalog,setCatalog]=useState<Item[]>([]);
 const [sales,setSales]=useState<Doc[]>([]),[purchases,setPurchases]=useState<Doc[]>([]);
 const [financial,setFinancial]=useState<Fin|null>(null),[aging,setAging]=useState<Aging[]>([]),[staging,setStaging]=useState<Staged[]>([]),[periods,setPeriods]=useState<Period[]>([]);
 const [busy,setBusy]=useState(false),[formOpen,setFormOpen]=useState(false);
 const [contactForm,setContactForm]=useState({name:'',kind:'customer',email:'',phone:'',taxNumber:''});
 const [itemForm,setItemForm]=useState({name:'',kind:'service',price:'0.00',unit:'وحدة',sku:''});
 const [docForm,setDocForm]=useState({contactId:'',issueDate:dateToday(),dueDate:dateToday(),reference:''});
 const [lines,setLines]=useState<Line[]>([blankLine()]);
 const [paymentId,setPaymentId]=useState(''),[paymentAmount,setPaymentAmount]=useState(''),[payDate,setPayDate]=useState(dateToday());
 const [detail,setDetail]=useState<any|null>(null);
 const [provider,setProvider]=useState('csv'),[externalId,setExternalId]=useState(''),[recordType,setRecordType]=useState('invoice'),[payload,setPayload]=useState('{\n  "total": "100.00"\n}');
 const [asOf,setAsOf]=useState(dateToday());
 const load=useCallback(async()=>{
   try{
     const data=await Promise.all([
       call<Contact[]>(root+'/contacts'),call<Item[]>(root+'/catalog'),
       call<Doc[]>(root+'/documents/sale'),call<Doc[]>(root+'/documents/purchase'),
       call<Fin>(root+'/reports/financial?asOf='+asOf),call<Aging[]>(root+'/reports/aging'),
       call<Staged[]>(root+'/integrations/staging'),call<Period[]>(root+'/periods')
     ]);
     setContacts(data[0]);setCatalog(data[1]);setSales(data[2]);setPurchases(data[3]);
     setFinancial(data[4]);setAging(data[5]);setStaging(data[6]);setPeriods(data[7]);
   }catch(e){notify((e as Error).message)}
 },[root,asOf,notify]);
 useEffect(()=>{load()},[load]);
 const docs=tab==='sales'?sales:purchases;
 const docKind=tab==='sales'?'sale':'purchase';
 const lineTotal=useMemo(()=>lines.reduce((n,l)=>n+(Number(l.unitPrice)||0)*l.quantity*(1+l.taxRate/100),0),[lines]);
 async function perform(task:()=>Promise<unknown>,success:string){
   setBusy(true);try{await task();notify(success);await load();setFormOpen(false)}catch(e){notify((e as Error).message)}finally{setBusy(false)}
 }
 function resetInvoice(){setDocForm({contactId:'',issueDate:dateToday(),dueDate:dateToday(),reference:''});setLines([blankLine()])}
 async function createContact(e:FormEvent){e.preventDefault();await perform(()=>call(root+'/contacts',{method:'POST',body:JSON.stringify(contactForm)}),'تم حفظ جهة الاتصال');setContactForm({name:'',kind:'customer',email:'',phone:'',taxNumber:''})}
 async function createItem(e:FormEvent){e.preventDefault();await perform(()=>call(root+'/catalog',{method:'POST',body:JSON.stringify(itemForm)}),'تمت إضافة الصنف');setItemForm({name:'',kind:'service',price:'0.00',unit:'وحدة',sku:''})}
 async function createDocument(e:FormEvent){e.preventDefault();
   await perform(()=>call(root+'/documents/'+docKind,{method:'POST',body:JSON.stringify({...docForm,lines,idempotencyKey:crypto.randomUUID()})}),'حُفظ المستند كمسودة. يلزم ترحيله قبل اعتباره مدرجًا في الحسابات');resetInvoice();
 }
 async function issueDoc(id:string){if(!confirm('ترحيل هذا المستند إلى دفتر الأستاذ؟ لا يمكن حذف القيد بعد الترحيل.'))return;
   await perform(()=>call(root+'/document/'+id+'/issue',{method:'POST',body:'{}'}),'تم ترحيل المستند إلى الحسابات. لا يمثل هذا تخليصًا لدى ZATCA');}
 async function payment(e:FormEvent){e.preventDefault();await perform(()=>call(root+'/document/'+paymentId+'/payments',{method:'POST',body:JSON.stringify({amount:paymentAmount,paidOn:payDate,idempotencyKey:crypto.randomUUID()})}),'تم تسجيل السداد في القيود');setPaymentId('');setPaymentAmount('')}
 async function stage(e:FormEvent){e.preventDefault();let parsed:any;
   try{parsed=JSON.parse(payload)}catch{notify('تأكدي من صحة JSON');return}
   await perform(()=>call(root+'/integrations/staging',{method:'POST',body:JSON.stringify({provider,externalId,recordType,payload:parsed})}),'سُجّل السجل كبيانات خارجية للمراجعة فقط؛ لم يرحل محاسبيًا');setExternalId('')
 }
 async function docDetail(id:string){try{setDetail(await call(root+'/document/'+id))}catch(e){notify((e as Error).message)}}
 async function closePeriod(id:string){if(!confirm('هل تريدين إقفال هذه الفترة؟ قد تمنع هذه العملية أي ترحيل لاحق داخلها.'))return;
   await perform(()=>call(root+'/periods/'+id+'/close',{method:'POST',body:'{}'}),'تم إقفال الفترة');}
 function saveCSV(){const rows=[['المستند','الجهة','الحالة','التاريخ','الإجمالي','المسدد'],...docs.map(d=>[d.document_no,d.contact_name,statusName(d.status),String(d.issue_date).slice(0,10),d.grand_total,d.paid_total])];
   const content='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
   const blob=new Blob([content],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`jawaher-${docKind}-documents.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),500);
 }
 if(tab==='contacts')return <section className="panel full-panel"><div className="panel-heading"><div><h3>دليل العملاء والموردين</h3><p>بيانات جهات الاتصال مرتبطة بالمنشأة الحالية</p></div>{canWrite&&<button className="primary" onClick={()=>setFormOpen(!formOpen)}>＋ جهة اتصال</button>}</div>
  {formOpen&&<form className="commerce-form" onSubmit={createContact}><div className="commerce-grid">
    <Labeled label="الاسم"><input required value={contactForm.name} onChange={e=>setContactForm({...contactForm,name:e.target.value})}/></Labeled>
    <Labeled label="نوع الجهة"><select value={contactForm.kind} onChange={e=>setContactForm({...contactForm,kind:e.target.value})}><option value="customer">عميل</option><option value="supplier">مورد</option><option value="both">عميل ومورد</option></select></Labeled>
    <Labeled label="البريد"><input type="email" value={contactForm.email} onChange={e=>setContactForm({...contactForm,email:e.target.value})}/></Labeled>
    <Labeled label="الجوال"><input value={contactForm.phone} onChange={e=>setContactForm({...contactForm,phone:e.target.value})}/></Labeled>
    <Labeled label="الرقم الضريبي (اختياري)"><input value={contactForm.taxNumber} onChange={e=>setContactForm({...contactForm,taxNumber:e.target.value})}/></Labeled>
   </div><button disabled={busy} className="primary">حفظ جهة الاتصال</button></form>}
  <div className="table-wrap"><table><thead><tr><th>الاسم</th><th>النوع</th><th>البريد الإلكتروني</th><th>الهاتف</th><th>الرقم الضريبي</th></tr></thead><tbody>{contacts.map(c=><tr key={c.id}><td><b>{c.name}</b></td><td>{kindName(c.kind)}</td><td>{c.email||'—'}</td><td>{c.phone||'—'}</td><td>{c.tax_number||'—'}</td></tr>)}</tbody></table>{!contacts.length&&<p className="jawaher-empty">لا توجد جهات اتصال حتى الآن.</p>}</div></section>;
 if(tab==='catalog')return <section className="panel full-panel"><div className="panel-heading"><div><h3>المنتجات والخدمات</h3><p>كتالوج وأسعار فقط، دون حركة مخزون أو قيود تكلفة بضاعة</p></div>{canWrite&&<button className="primary" onClick={()=>setFormOpen(!formOpen)}>＋ صنف جديد</button>}</div>
  {formOpen&&<form className="commerce-form" onSubmit={createItem}><div className="commerce-grid">
    <Labeled label="اسم الصنف"><input required value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})}/></Labeled>
    <Labeled label="التصنيف"><select value={itemForm.kind} onChange={e=>setItemForm({...itemForm,kind:e.target.value})}><option value="service">خدمة</option><option value="product">منتج</option></select></Labeled>
    <Labeled label="سعر البيع"><input required inputMode="decimal" value={itemForm.price} onChange={e=>setItemForm({...itemForm,price:e.target.value})}/></Labeled>
    <Labeled label="الوحدة"><input value={itemForm.unit} onChange={e=>setItemForm({...itemForm,unit:e.target.value})}/></Labeled>
    <Labeled label="الرمز (اختياري)"><input value={itemForm.sku} onChange={e=>setItemForm({...itemForm,sku:e.target.value})}/></Labeled>
   </div><button disabled={busy} className="primary">حفظ الصنف</button></form>}
   <div className="table-wrap"><table><thead><tr><th>الرمز</th><th>اسم الصنف</th><th>التصنيف</th><th>الوحدة</th><th>السعر</th></tr></thead><tbody>{catalog.map(i=><tr key={i.id}><td>{i.sku||'—'}</td><td><b>{i.name}</b></td><td>{kindName(i.kind)}</td><td>{i.unit}</td><td>{money(i.price)} ر.س</td></tr>)}</tbody></table></div></section>;
 if(tab==='sales'||tab==='purchases')return <section className="panel full-panel"><div className="panel-heading"><div><h3>{tab==='sales'?'فواتير المبيعات':'فواتير المشتريات'}</h3><p>المسودة لا تؤثر في الحسابات حتى الترحيل · النسخة لا تصدر فاتورة معتمدة من ZATCA</p></div><div className="commerce-actions">{docs.length>0&&<button onClick={saveCSV} className="secondary">تصدير CSV</button>}{canWrite&&<button className="primary" onClick={()=>setFormOpen(!formOpen)}>＋ مستند جديد</button>}</div></div>
  {formOpen&&<form onSubmit={createDocument} className="commerce-form">
   <div className="commerce-grid">
    <Labeled label={tab==='sales'?'اختاري العميل':'اختاري المورد'}><select value={docForm.contactId} required onChange={e=>setDocForm({...docForm,contactId:e.target.value})}><option value="">— اختاري —</option>{contacts.filter(c=>c.kind==='both'||c.kind===(tab==='sales'?'customer':'supplier')).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Labeled>
    <Labeled label="تاريخ المستند"><input type="date" required value={docForm.issueDate} onChange={e=>setDocForm({...docForm,issueDate:e.target.value})}/></Labeled>
    <Labeled label="تاريخ الاستحقاق"><input type="date" min={docForm.issueDate} required value={docForm.dueDate} onChange={e=>setDocForm({...docForm,dueDate:e.target.value})}/></Labeled>
    <Labeled label="مرجع داخلي"><input value={docForm.reference} onChange={e=>setDocForm({...docForm,reference:e.target.value})}/></Labeled>
   </div>
   <h4>بنود المستند</h4>
   {lines.map((l,i)=><div key={i} className="commerce-line">
    <input required placeholder="البيان أو اسم الخدمة" aria-label="وصف البند" value={l.description} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,description:e.target.value}:x))}/>
    <input type="number" min={1} step={1} required aria-label="الكمية" value={l.quantity} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,quantity:Number(e.target.value)}:x))}/>
    <input inputMode="decimal" required aria-label="سعر الوحدة" value={l.unitPrice} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,unitPrice:e.target.value}:x))}/>
    <select aria-label="نسبة الضريبة" value={l.taxRate} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,taxRate:Number(e.target.value)}:x))}><option value={15}>15% مثال قياسي</option><option value={0}>0% اختبار فقط</option></select>
    <button type="button" className="secondary" disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,j)=>j!==i))}>×</button>
   </div>)}
   <div className="commerce-form-bottom"><button type="button" className="secondary" onClick={()=>setLines([...lines,blankLine()])}>＋ سطر</button><strong>تقدير الإجمالي: {money(lineTotal)} ر.س</strong><button disabled={busy} className="primary">حفظ مسودة</button></div>
  </form>}
  {paymentId&&<form className="commerce-form" onSubmit={payment}><h4>تسجيل تحصيل / سداد</h4><div className="commerce-grid"><Labeled label="المبلغ بالريال"><input required inputMode="decimal" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></Labeled><Labeled label="التاريخ"><input required type="date" value={payDate} onChange={e=>setPayDate(e.target.value)}/></Labeled></div><button disabled={busy} className="primary">اعتماد السداد وترحيله</button><button type="button" className="secondary" onClick={()=>setPaymentId('')}>إلغاء</button></form>}
  <div className="table-wrap"><table><thead><tr><th>رقم</th><th>الجهة</th><th>التاريخ</th><th>الاستحقاق</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{docs.map(d=><tr key={d.id}>
   <td>#{d.document_no}</td><td><b>{d.contact_name}</b></td><td>{String(d.issue_date).slice(0,10)}</td><td>{String(d.due_date).slice(0,10)}</td><td>{money(d.grand_total)}</td><td>{money(moneyValue(d.grand_total)-moneyValue(d.paid_total))}</td><td><span className={'status '+(d.status==='draft'?'draft':'posted')}>{statusName(d.status)}</span></td>
   <td><div className="commerce-actions"><button className="secondary" onClick={()=>docDetail(d.id)}>تفاصيل</button>{canWrite&&d.status==='draft'&&<button className="small-primary" disabled={busy} onClick={()=>issueDoc(d.id)}>ترحيل</button>}{canWrite&&['issued','partial'].includes(d.status)&&<button className="small-primary" onClick={()=>{setPaymentId(d.id);setPaymentAmount((moneyValue(d.grand_total)-moneyValue(d.paid_total)).toFixed(2))}}>سداد</button>}</div></td>
  </tr>)}</tbody></table>{!docs.length&&<p className="jawaher-empty">لا توجد مستندات بعد. أنشئي جهة اتصال أولًا ثم مستندًا.</p>}</div>
  {detail&&<div className="commerce-detail"><button className="secondary" onClick={()=>setDetail(null)}>× إغلاق التفاصيل</button><h4>تفاصيل المستند #{detail.document_no}</h4><p>الجهة: {detail.contact_name} · الحالة: {statusName(detail.status)} · إجمالي: {money(detail.grand_total)} ريال</p><div className="table-wrap"><table><thead><tr><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>الضريبة</th></tr></thead><tbody>{detail.lines?.map((l:any,i:number)=><tr key={i}><td>{l.description}</td><td>{l.quantity}</td><td>{money(l.unit_price)}</td><td>{money(l.line_tax)}</td></tr>)}</tbody></table></div><p className="compliance-note">مستند تجريبي داخلي، ليس فاتورة ZATCA إلكترونية صالحة للإرسال.</p></div>}
 </section>;
 if(tab==='financial')return <><div className="panel-heading standalone"><div><h3>الأداء المالي</h3><p>تجميعة القيود المرحلة فقط حتى التاريخ المحدد</p></div><Labeled label="حتى تاريخ"><input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></Labeled></div>
   <div className="stat-grid"><div className="stat-card"><div className="stat-header">الإيرادات</div><div className="stat-value commerce-stat">{money(financial?.income)}</div><small>ريال سعودي</small></div><div className="stat-card"><div className="stat-header">المصروفات</div><div className="stat-value commerce-stat">{money(financial?.expenses)}</div><small>ريال سعودي</small></div><div className="stat-card featured"><div className="stat-header">صافي النتيجة</div><div className="stat-value commerce-stat">{money(financial?.netProfit)}</div><small>ريال سعودي</small></div><div className="stat-card"><div className="stat-header">الذمم المدينة</div><div className="stat-value commerce-stat">{money(financial?.receivables)}</div><small>ريال سعودي</small></div></div>
   <section className="panel full-panel"><div className="panel-heading"><h3>معادلة المركز المالي — عرض مبدئي</h3><span className={'status '+(financial?.equationBalanced?'posted':'draft')}>{financial?.equationBalanced?'متوازنة':'تحتاج مراجعة'}</span></div>
    <div className="commerce-metrics">{[['الأصول',financial?.assets],['الالتزامات',financial?.liabilities],['حقوق الملكية',financial?.equity],['الأرباح المتراكمة على بيانات التجربة',financial?.retainedEarnings],['الذمم الدائنة',financial?.payables]].map(([k,v])=><div key={k}><span>{k}</span><strong>{money(v)} ر.س</strong></div>)}</div><p className="compliance-note">لا يشمل قيود إقفال الأرباح، ولا يمثل قجواهر مالية مدققة أو متوافقة تلقائيًا مع جميع المعايير المحاسبية.</p>
   </section></>;
 if(tab==='aging')return <section className="panel full-panel"><div className="panel-heading"><div><h3>أعمار الذمم</h3><p>المبالغ المتبقية وتواريخ التأخير</p></div><span className="env-label">{aging.length} سجلات مفتوحة</span></div>
   <div className="table-wrap"><table><thead><tr><th>المستند</th><th>النوع</th><th>جهة الاتصال</th><th>الاستحقاق</th><th>الأيام المتأخرة</th><th>الرصيد</th></tr></thead><tbody>{aging.map((a,i)=><tr key={i}><td>#{a.document_no}</td><td>{a.kind==='sale'?'مدين':'دائن'}</td><td>{a.contact_name}</td><td>{String(a.due_date).slice(0,10)}</td><td>{a.overdue_days>0?<span className="status draft">{a.overdue_days}</span>:'ضمن المدة'}</td><td>{money(a.outstanding)} ر.س</td></tr>)}</tbody></table></div></section>;
 if(tab==='insights'){
   const late=aging.filter(a=>a.overdue_days>0);
   const lateSum=late.reduce((s,a)=>s+Number(a.outstanding),0);
   const profit=Number(financial?.netProfit||0);
   return <div className="insights-grid"><section className="panel info-panel"><div className="eyebrow">جواهر بصيرة — قواعد حسابية شفافة</div><h3>ملخص المخاطر المالية</h3><p>هذه نتائج قواعد حتمية من سجلات النظام، وليست تنبؤات أو إجابات ذكاء اصطناعي توليدي.</p><div className="insight-number">{late.length}</div><b>مستندات متأخرة الاستحقاق</b><p>إجمالي المبالغ المتأخرة: {money(lateSum)} ر.س</p></section>
   <section className="panel info-panel"><div className="eyebrow">مؤشرات أعمالك</div><h3>قراءة مبسطة</h3><p>صافي النتيجة الحالي: <b>{money(profit)} ر.س</b></p><p>عدد المستندات: {(financial?.sales||0)+(financial?.purchases||0)}</p><p>عدد جهات الاتصال: {financial?.contacts||0}</p><p className="compliance-note">المساعد اللغوي والتحليلات التنبؤية والتحقيق في الرقم تحتاج تنفيذًا وربطًا واختبارات إضافية.</p></section></div>;
 }
 if(tab==='bridge')return <section className="panel full-panel"><div className="panel-heading"><div><h3>جواهر جسر — التكاملات</h3><p>منطقة استقبال وتوحيد أولية للسجلات الخارجية، في وضع المراجعة فقط</p></div><span className="status draft">قراءة/تجهيز، بلا مزامنة مباشرة</span></div>
   <div className="commerce-grid integration-providers">{[['وافق','wafeq'],['Xero','xero'],['ERPNext','erpnext'],['Odoo','odoo'],['سماك','smacc'],['CSV','csv']].map(([name,id])=><div key={id} className="integration-chip"><b>{name}</b><span>موصل يحتاج تهيئة واعتماد الوصول</span></div>)}</div>
   {canWrite&&<form className="commerce-form" onSubmit={stage}><h4>إدخال سجل خارجي تجريبي للمراجعة</h4><div className="commerce-grid"><Labeled label="المصدر"><select value={provider} onChange={e=>setProvider(e.target.value)}>{['csv','wafeq','xero','erpnext','odoo','smacc','other'].map(s=><option key={s} value={s}>{s}</option>)}</select></Labeled><Labeled label="معرف السجل الخارجي"><input required value={externalId} onChange={e=>setExternalId(e.target.value)}/></Labeled><Labeled label="نوع السجل"><select value={recordType} onChange={e=>setRecordType(e.target.value)}>{['invoice','bill','contact','account','journal'].map(s=><option key={s}>{s}</option>)}</select></Labeled></div><Labeled label="بيانات السجل بصيغة JSON"><textarea rows={5} dir="ltr" value={payload} onChange={e=>setPayload(e.target.value)}/></Labeled><button disabled={busy} className="primary">استقبال للمراجعة</button></form>}
   <div className="table-wrap"><table><thead><tr><th>المصدر</th><th>المعرف</th><th>النوع</th><th>الحالة</th></tr></thead><tbody>{staging.map(s=><tr key={s.id}><td>{s.provider}</td><td>{s.external_id}</td><td>{s.record_type}</td><td><span className="status draft">{statusName(s.status)}</span></td></tr>)}</tbody></table></div><p className="compliance-note">لا يوجد ربط تلقائي مفعل مع حسابات مزودي الخدمة. لا تدخل البيانات المستوردة في دفتر الأستاذ إلا عبر عملية محاسبية مستقلة ومدققة.</p>
  </section>;
 if(tab==='compliance')return <ZatcaWorkspace companyId={companyId} canWrite={canWrite} isOwner={isOwner}/>;
 if(tab==='settings')return <section className="panel full-panel"><div className="panel-heading"><div><h3>الفترات المالية</h3><p>يمكن للمالك إغلاق الفترة بعد معالجة المسودات. لا توجد آلية إعادة فتح في هذه النسخة.</p></div></div><div className="table-wrap"><table><thead><tr><th>الفترة</th><th>من</th><th>إلى</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{periods.map(p=><tr key={p.id}><td><b>{p.title}</b></td><td>{String(p.starts_on).slice(0,10)}</td><td>{String(p.ends_on).slice(0,10)}</td><td>{p.status==='open'?'مفتوحة':'مغلقة'}</td><td>{canWrite&&p.status==='open'?<button className="secondary" onClick={()=>closePeriod(p.id)}>إقفال الفترة</button>:'—'}</td></tr>)}</tbody></table></div></section>;
 return null;
}
