/* JAWAHER MIZAN ZATCA preparation utilities. NOT a ZATCA certification or signing SDK. */
import { createHash } from 'node:crypto';

export const ZATCA_SIM_BASE = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation' as const;
export const ZATCA_ENDPOINTS = {
  complianceCsid: '/compliance',
  complianceInvoices: '/compliance/invoices',
  productionCsidInSimulation: '/production/csids',
  clearance: '/invoices/clearance/single',
  reporting: '/invoices/reporting/single',
} as const;
export type SubmissionKind = 'clearance' | 'reporting' | 'complianceInvoices';
export type ZatcaProfile = {
  legalName: string;
  vatNumber: string;
  crNumber?: string;
  buildingNumber: string;
  street: string;
  district: string;
  city: string;
  postalCode: string;
  countryCode: 'SA';
  deviceLabel: string;
};
export function validateVat(v: unknown): boolean {
  return typeof v==='string' && /^3\d{13}3$/.test(v);
}
export function validateProfile(p: Partial<ZatcaProfile>): string[] {
  const problems:string[]=[];
  if(!p.legalName?.trim()) problems.push('الاسم القانوني للمنشأة مطلوب');
  if(!validateVat(p.vatNumber)) problems.push('رقم التسجيل في ضريبة القيمة المضافة: 15 رقمًا يبدأ وينتهي بـ3');
  if(!/^\d{4}$/.test(p.buildingNumber||'')) problems.push('رقم المبنى يجب أن يتكون من 4 أرقام');
  if(!p.street?.trim()) problems.push('اسم الشارع مطلوب');
  if(!p.district?.trim()) problems.push('الحي مطلوب');
  if(!p.city?.trim()) problems.push('المدينة مطلوبة');
  if(!/^\d{5}$/.test(p.postalCode||'')) problems.push('الرمز البريدي يجب أن يتكون من 5 أرقام');
  if(p.countryCode!=='SA') problems.push('البلد يجب أن يكون SA');
  if(!p.deviceLabel?.trim()) problems.push('معرّف وحدة الفوترة (EGS) مطلوب');
  return problems;
}
export type PreparedDocument = {
  kind: string;
  status: string;
  invoiceCategory?: 'standard'|'simplified'|null;
  contactName?: string|null;
  contactTaxNumber?: string|null;
  issueDate?: string;
  subtotal?: string;
  vatTotal?: string;
  lineCount?: number;
  unsupportedRates?: number;
};
export function preflightDocument(p: Partial<ZatcaProfile>|null, d: PreparedDocument): string[] {
  const issues = p ? validateProfile(p) : ['ملف بيانات المنشأة الضريبية غير مكتمل'];
  if(d.kind!=='sale') issues.push('التكامل الحالي يجهز مستندات المبيعات فقط؛ فواتير المشتريات ليست فواتير صادرة من المنشأة');
  if(!d.invoiceCategory) issues.push('يجب تحديد الفاتورة القياسية أو المبسطة');
  if(!d.contactName?.trim()) issues.push('بيانات العميل غير مكتملة');
  if(d.invoiceCategory==='standard' && !validateVat(d.contactTaxNumber)) issues.push('رقم المشتري الضريبي غير مكتمل للفحص الأولي للفواتير القياسية (راجع حالات المشتري غير المسجل)');
  if(!d.issueDate) issues.push('تاريخ الإصدار غير محدد');
  if(!Number.isInteger(d.lineCount) || Number(d.lineCount)<1) issues.push('الفاتورة تحتاج بنودًا');
  if(Number(d.unsupportedRates||0)>0) issues.push('يجب مراجعة أسباب النسبة الصفرية والإعفاءات والرموز الضريبية');
  if(d.status==='draft') issues.push('المستند مسودة داخلية؛ لا يُرسل إلى الهيئة');
  if(!['draft','issued','partial','paid'].includes(d.status)) issues.push('حالة المستند غير معروفة');
  issues.push('معلق: توليد UBL XML النهائي والتوقيع الرقمي والسلسلة وQR والتحقق باستخدام ZATCA SDK');
  return issues;
}
export type SignedEnvelope = { invoiceHash:string; uuid:string; invoice:string };
export function assertSignedEnvelope(body:unknown):SignedEnvelope {
  if(!body || typeof body!=='object') throw new Error('يجب تقديم كائن المستند الموقع');
  const b=body as Record<string,unknown>;
  if(typeof b.uuid!=='string'|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.uuid)) throw new Error('UUID غير صالح');
  if(typeof b.invoiceHash!=='string'|| !/^[A-Za-z0-9+/]{43}=$/.test(b.invoiceHash)) throw new Error('invoiceHash يجب أن يكون SHA-256 بترميز Base64');
  if(typeof b.invoice!=='string'||b.invoice.length<80||b.invoice.length>700_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.invoice)) throw new Error('invoice يجب أن يكون XML بصيغة Base64 وحجم مناسب');
  const xml=Buffer.from(b.invoice,'base64').toString('utf8');
  if(!xml.includes('<Invoice')&&!xml.includes(':Invoice')) throw new Error('يجب تقديم مستند XML Invoice');
  if(!xml.includes('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2')) throw new Error('المستند لا يشير إلى UBL Invoice 2');
  // Structural sanity only: not signature / UBL / tax correctness verification.
  return {invoiceHash:b.invoiceHash, uuid:b.uuid, invoice:b.invoice};
}
export function envelopeFingerprint(e:SignedEnvelope):string {
  return createHash('sha256').update(e.invoice).digest('hex');
}
export function sandboxAvailable(companyId:string,env:NodeJS.ProcessEnv=process.env) {
  return env.ZATCA_SIM_ENABLED==='true'
    && env.ZATCA_SIM_COMPANY_ID===companyId
    && Boolean(env.ZATCA_SIM_BINARY_SECURITY_TOKEN)
    && Boolean(env.ZATCA_SIM_SECRET);
}
export function assertSimulationReady(companyId:string,env:NodeJS.ProcessEnv=process.env) {
  if(!sandboxAvailable(companyId,env)) throw new Error('بيئة المحاكاة غير مهيأة لهذه المنشأة؛ الإرسال معطل');
}
export function validateSubmissionKind(kind:string, invoiceType:'standard'|'simplified') {
  if(!['clearance','reporting','complianceInvoices'].includes(kind)) throw new Error('نوع عملية ZATCA غير صالح');
  if(kind==='clearance' && invoiceType!=='standard') throw new Error('التخليص يستخدم للفاتورة القياسية');
  if(kind==='reporting' && invoiceType!=='simplified') throw new Error('الإبلاغ يستخدم للفاتورة المبسطة');
}
export async function callZatcaSimulation(companyId:string, kind:SubmissionKind, payload:SignedEnvelope,
  env:NodeJS.ProcessEnv=process.env, requester:typeof fetch=fetch):Promise<{httpStatus:number,body:unknown}> {
  assertSimulationReady(companyId,env);
  const token=env.ZATCA_SIM_BINARY_SECURITY_TOKEN!;
  const secret=env.ZATCA_SIM_SECRET!;
  const target=ZATCA_SIM_BASE+ZATCA_ENDPOINTS[kind];
  // Only official fixed allowlisted host; never accept URLs from the request.
  const headers:Record<string,string>={
    'Accept':'application/json', 'Content-Type':'application/json',
    'Accept-Version':'V2','Accept-Language':'ar',
    'Authorization':`Basic ${Buffer.from(`${token}:${secret}`).toString('base64')}`,
  };
  if(kind==='clearance') headers['Clearance-Status']='1';
  const response=await requester(target,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(15_000),redirect:'error'});
  let result:unknown;
  const raw=(await response.text()).slice(0,32_000);
  try{result=JSON.parse(raw);}catch{result={message:'Non-JSON ZATCA response',truncated:true};}
  return {httpStatus:response.status,body:result};
}
