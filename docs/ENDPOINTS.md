# واجهات REST المُنفذة — الإصدار 0.1

كل المسارات تبدأ عند `http://localhost:4000`. تستلزم جميع طلبات POST رأس `X-Jawaher-Client: web` و`Content-Type: application/json`، مع جلسة cookies بعد تسجيل الدخول. الاستجابات JSON.

| الطريقة | المسار | النتيجة |
|---|---|---|
| GET | `/health` | حالة قاعدة البيانات |
| POST | `/auth/register` | إنشاء مستخدم ومنشأة مع دليل حسابات افتراضي |
| POST | `/auth/login` | دخول المستخدم |
| GET | `/auth/me` | المستخدم الحالي |
| POST | `/auth/logout` | إنهاء الجلسة |
| GET | `/companies` | المنشآت المتاحة للمستخدم |
| GET | `/companies/{cid}/dashboard` | عدد الحسابات والقيود |
| GET | `/companies/{cid}/accounts` | قائمة الحسابات |
| POST | `/companies/{cid}/accounts` | إنشاء حساب |
| GET | `/companies/{cid}/periods` | الفترات المالية |
| GET | `/companies/{cid}/journals` | قائمة القيود |
| POST | `/companies/{cid}/journals` | إضافة قيد مسودة |
| GET | `/companies/{cid}/journals/{jid}` | تفاصيل القيد |
| POST | `/companies/{cid}/journals/{jid}/post` | ترحيل القيد |
| GET | `/companies/{cid}/reports/trial-balance?asOf=YYYY-MM-DD` | ميزان مراجعة |
| GET | `/companies/{cid}/audit` | آخر أحداث التدقيق |

## مثال إنشاء مسودة
```json
{
  "periodId": "UUID_FROM_GET_PERIODS",
  "entryDate": "2026-10-20",
  "memo": "إيداع رأس المال",
  "idempotencyKey": "a-unique-random-string",
  "lines": [
    {"accountId":"UUID_OF_BANK_ACCOUNT","debit":"1000.00","credit":"0"},
    {"accountId":"UUID_OF_CAPITAL_ACCOUNT","debit":"0","credit":"1000.00"}
  ]
}
```

## تنبيهات تقنية
- تسجيل كلمة المرور يستخدم `scrypt` وملحًا عشوائيًا، والجلسات محفوظة كتجزئة hash وليس بالنص الأصلي.
- لا توجد واجهة `DELETE` أو تعديل القيد المرحّل.
- لا تتوفر خدمات إصدار فواتير إلكترونية أو API مع برامج محاسبية خارجية بعد.
- مثال Smoke في `api/scripts/smoke.mjs` يجرب المسارات في بيئة Docker عاملة، لكنه ليس بديلًا عن اختبارات الأمان أو الامتثال.


## ZATCA simulation preparation (v1.1; NON-PRODUCTION)

- `GET /companies/:cid/zatca/status`
- `POST /companies/:cid/zatca/profile`
- `GET /companies/:cid/zatca/documents`
- `POST /companies/:cid/zatca/documents/:id/category`
- `GET /companies/:cid/zatca/documents/:id/preflight`
- `GET /companies/:cid/zatca/simulation/history`
- `POST /companies/:cid/zatca/documents/:id/simulation/:operation` where `operation=clearance|reporting|complianceInvoices`, simulation credentials explicitly enabled, document XML must be signed externally.

There are **no production ZATCA endpoints** and **no compliant signed XML generation** in this release.
