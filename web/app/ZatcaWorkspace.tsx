'use client';
import {FormEvent,useCallback,useEffect,useState} from 'react';

const API='/backend';
type Profile={legalName:string;vatNumber:string;crNumber:string;buildingNumber:string;street:string;district:string;city:string;postalCode:string;countryCode:string;deviceLabel:string};
type Status={profile:Profile|null;preflightIssues:string[];simulationConfigured:boolean;productionConnected:boolean;outstanding:string[];simulationBaseUrl:string};
type Document={id:string;document_no:number;kind:string;status:string;issue_date:string;grand_total:string;invoice_category:string;customer_name:string};
type Attempt={id:string;document_id:string;operation:string;invoice_uuid:string;http_status:number;outcome:string;created_at:string};
const blank:Profile={legalName:'',vatNumber:'',crNumber:'',buildingNumber:'',street:'',district:'',city:'',postalCode:'',countryCode:'SA',deviceLabel:''};
const fields:{name:keyof Profile;label:string;placeholder:string}[]=[
 {name:'legalName',label:'الاسم القانوني المسجل',placeholder:'شركة ...'},
 {name:'vatNumber',label:'رقم تسجيل ضريبة القيمة المضافة',placeholder:'3XXXXXXXXXXXXX3'},
 {name:'crNumber',label:'السجل التجاري (إن وجد)',placeholder:'رقم السجل'},
 {name:'buildingNumber',label:'رقم المبنى الوطني',placeholder:'4 أرقام'},
 {name:'street',label:'الشارع',placeholder:'اسم الشارع'},
 {name:'district',label:'الحي',placeholder:'الحي'},
 {name:'city',label:'المدينة',placeholder:'المدينة'},
 {name:'postalCode',label:'الرمز البريدي',placeholder:'5 أرقام'},
 {name:'deviceLabel',label:'اسم وحدة الفوترة EGS',placeholder:'JAWAHER-EGS-01'},
 ];
async function call<T>(path:string,init:RequestInit={}):Promise<T>{
 const response=await fetch(API+path,{...init,cache:'no-store',credentials:'include',headers:{'Content-Type':'application/json','X-Jawaher-Client':'web',...(init.headers||{})}});
 const json=await response.json().catch(()=>({message:'تعذر قراءة استجابة الخادم'}));
 if(!response.ok)throw new Error(Array.isArray(json.message)?json.message.join('؛ '):json.message||`HTTP ${response.status}`);
 return json as T;
}
export default function ZatcaWorkspace({companyId,isOwner,canWrite}:{companyId:string;isOwner:boolean;canWrite:boolean}){
 const prefix=`/companies/${companyId}/zatca`;
 const [status,setStatus]=useState<Status|null>(null),[profile,setProfile]=useState<Profile>(blank);
 const [documents,setDocuments]=useState<Document[]>([]),[attempts,setAttempts]=useState<Attempt[]>([]);
 const [issues,setIssues]=useState<string[]|null>(null),[selectedDoc,setSelectedDoc]=useState('');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
  const [st,docs,history]=await Promise.all([call<Status>(prefix+'/status'),call<Document[]>(prefix+'/documents'),call<Attempt[]>(prefix+'/simulation/history')]);
  setStatus(st);setProfile(st.profile||blank);setDocuments(docs);setAttempts(history);
 },[prefix]);
 useEffect(()=>{refresh().catch(e=>setMessage(e.message))},[refresh]);
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');try{
  await call(prefix+'/profile',{method:'POST',body:JSON.stringify(profile)});
  await refresh();setMessage('تم حفظ بيانات المنشأة المبدئية، ولم يتم توصيل الهيئة بعد.');
 }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 async function category(docId:string,category:string){setBusy(true);setMessage('');setIssues(null);try{
  await call(prefix+'/documents/'+docId+'/category',{method:'POST',body:JSON.stringify({invoiceCategory:category})});
  await refresh();setMessage('تم تعيين نوع الفاتورة للفحص الأولي.');
 }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 async function preflight(id:string){setBusy(true);setMessage('');setSelectedDoc(id);try{
  const r=await call<{issues:string[];note:string}>(prefix+'/documents/'+id+'/preflight');
  setIssues(r.issues);
 }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 return <div className="zatca-space">
   <section className="panel info-panel">
    <div className="eyebrow">جواهر ميزان · بوابة الامتثال السعودية</div>
    <h3>تجهيز الربط مع هيئة الزكاة والضريبة والجمارك</h3>
    <div className="risk-banner">بيئة إعداد واختبار فقط — لا يوجد ربط إنتاجي أو صلاحية لإصدار فواتير ZATCA من هذه النسخة.</div>
    <div className="zatca-tiles">
     <div><small>بيانات المنشأة</small><strong>{status?.profile?'مسجلة مبدئيًا':'لم تكتمل'}</strong></div>
     <div><small>شهادات المحاكاة على الخادم</small><strong>{status?.simulationConfigured?'مهيأة للاختبار':'غير مهيأة'}</strong></div>
     <div><small>حالة الإنتاج</small><strong>معطل للحماية</strong></div>
    </div>
    <p>يبدأ الربط بإعداد ملف ضريبي صحيح، ثم تجهيز XML وفق UBL وتوقيعه وفحصه باستخدام أدوات الهيئة، واستكمال خطوات CSID واختبارات المحاكاة. كل بيئة مستقلة، ولا يجوز وضع مفاتيح حقيقية في المتصفح أو الملفات المشتركة.</p>
   </section>
   {message&&<div className="notice" role="status">{message}</div>}
   <section className="panel zatca-section">
    <div className="panel-heading"><div><h3>1. بيانات المنشأة الضريبية</h3><p>البيانات محفوظة في قاعدة الشركة. أرقام المثال لا تؤدي إلى أي تسجيل لدى الهيئة.</p></div></div>
    <form onSubmit={save} className="zatca-form">
     <div className="commerce-grid">
      {fields.map(f=><label key={f.name} className="field"><span>{f.label}</span>
       <input disabled={!isOwner||busy} value={profile[f.name]} placeholder={f.placeholder} dir={['vatNumber','buildingNumber','postalCode','crNumber'].includes(f.name)?'ltr':'rtl'}
       onChange={e=>setProfile(p=>({...p,[f.name]:e.target.value}))}/></label>)}
     </div>
     <small>بلد الفوترة: المملكة العربية السعودية (SA). يجب مطابقة القيم مع سجلات المنشأة الفعلية ومراجعتها من مختص.</small>
     {isOwner?<button type="submit" disabled={busy} className="primary">{busy?'جارٍ الحفظ...':'حفظ الملف الضريبي'}</button>:<span className="compliance-note">تعديل الملف الضريبي يحتاج صلاحية مالك المنشأة.</span>}
    </form>
   </section>
   <section className="panel zatca-section">
    <div className="panel-heading"><div><h3>2. تجهيز فواتير المبيعات</h3><p>حددي النوع ثم شغلي فحصًا مبدئيًا؛ هذا ليس توقيعًا أو تخليصًا إلكترونيًا.</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>الحالة</th><th>نوع ZATCA</th><th>الفحص</th></tr></thead><tbody>
     {documents.map(d=><tr key={d.id}><td>#{d.document_no}</td><td>{d.customer_name}</td><td>{d.status}</td><td>
      <select aria-label="نوع الفاتورة" disabled={!canWrite||busy} value={d.invoice_category||''} onChange={e=>category(d.id,e.target.value)}>
       <option value="" disabled>اختاري</option><option value="standard">قياسية</option><option value="simplified">مبسطة</option>
      </select></td><td><button className="secondary" disabled={busy} onClick={()=>preflight(d.id)}>فحص المبدئي</button></td></tr>)}
    </tbody></table>{documents.length===0&&<p className="jawaher-empty">لا توجد فواتير مبيعات بعد؛ أنشئي فاتورة تجريبية من تبويب المبيعات.</p>}</div>
    {issues&&<div className="zatca-issues"><b>نتائج فحص المستند {selectedDoc.slice(0,8)}:</b>
     <ul>{issues.map((x,i)=><li key={i}>{x}</li>)}</ul><small>هذه ملاحظات محلية ولا تغني عن فحص ZATCA SDK أو المتطلبات الرسمية.</small></div>}
   </section>
   <section className="panel zatca-section">
    <div className="panel-heading"><div><h3>3. مراحل الربط التقني</h3><p>خطوات لابد من إكمالها قبل تشغيل الإنتاج</p></div></div>
    <div className="zatca-checklist">{(status?.outstanding||[]).map((i,n)=><div key={i}><span>{n+1}</span><p>{i}</p><b>غير مكتمل</b></div>)}</div>
    <p className="compliance-note">مسارات المحاكاة مبرمجة في الخادم ومقفلة افتراضيًا؛ يتطلب استخدامها CSID وSecret تجريبيين وملف XML موقعًا مسبقًا. لا يوجد زر يرسل مستندات تلقائيًا.</p>
   </section>
   <section className="panel zatca-section">
    <div className="panel-heading"><div><h3>4. سجل طلبات المحاكاة</h3><p>يعرض بيانات الحالة فقط، دون كشف الشهادات أو المستندات الضريبية</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>الوقت</th><th>المسار</th><th>HTTP</th><th>النتيجة</th></tr></thead><tbody>{attempts.map(a=><tr key={a.id}>
     <td>{new Date(a.created_at).toLocaleString('ar-SA')}</td><td>{a.operation}</td><td>{a.http_status}</td><td>{a.outcome}</td>
    </tr>)}</tbody></table>{attempts.length===0&&<p className="jawaher-empty">لم تُرسل أي طلبات محاكاة حتى الآن.</p>}</div>
    <p className="compliance-note">المرجع الرسمي: <a href="https://zatca.gov.sa/ar/E-Invoicing/Pages/default.aspx" target="_blank" rel="noopener noreferrer">الهيئة — الفوترة الإلكترونية</a></p>
   </section>
 </div>;
}
