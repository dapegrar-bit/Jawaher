# جواهر ميزان — JAWAHER MIZAN v2.0

**برنامج محاسبي تجريبي قابل للتطوير — كود كامل للواجهة والخادم وقاعدة البيانات وواجهات API.**

> مهم: لا يُعد جاهزًا لاستخدام مالي إنتاجي أو متوافقًا مع ZATCA Phase 2؛ أدوات ZATCA هنا للتحضير والمحاكاة فقط، وليست توقيع XML معتمدًا أو اتصال إنتاج.

## المكونات

- **Next.js / React / TypeScript**: واجهة عربية RTL، لوحة تحكم، حسابات، قيود، مبيعات، مشتريات، سداد، تقارير، تجهيز زاتكا.
- **NestJS / Node.js / TypeScript**: خادم API مع جلسات دخول، عزل شركات أساسي، محرك قيود، محاسبة تجريبية وسجل تدقيق.
- **PostgreSQL**: قاعدة حقيقية؛ تعمل محليًا عبر Docker أو في **Supabase**.
- **Redis**: تحديد معدل محاولات تسجيل الدخول والتسجيل، محليًا أو عبر Render Key Value.
- **GitHub**: إعداد CI للاختبارات والبناء وDependabot.
- **Render**: ملف `render.yaml` لخدمة ويب عامة وAPI خاص وRedis.
- **Replit**: ملف `.replit` وسكربت بدء للتطوير عند توفير Supabase.

## 1) تشغيل كامل على الكمبيوتر (Docker)

يلزم Docker Engine/Compose. من جذر المشروع:

```bash
cp .env.example .env
# عدّلي POSTGRES_PASSWORD في .env إلى كلمة مرور قوية لا تتضمن علامات تحتاج URL encoding

docker compose up -d --build db redis
docker compose --profile tools run --rm migrate
docker compose up -d --build api web
```

افتحي: `http://localhost:3000` (الواجهة) و`http://localhost:3000/backend/health` (فحص API عبر الوسيط).

- الملفات محفوظة في Docker volumes؛ استخدمي `docker compose down` **دون** `-v`.
- تشغيل التحديثات بعد أي تغيير للجداول: `docker compose --profile tools run --rm migrate`.
- لا تنشري Docker Compose الحالي كما هو على الإنترنت؛ هو مُعدّ للتطوير المحلي.

## 2) GitHub + Supabase + Render (نشر تجريبي)

الخطوات مفصلة في **`docs/arabic/GITHUB_SUPABASE_RENDER_GUIDE.md`**. المختصر:

1. افتحي مستودع GitHub **خاصًا** باسم `jawaher-mizan` وارفعي الملفات (دون `.env`).
2. أنشئي مشروع Supabase PostgreSQL؛ شغلي ملف `db/ALL_SUPABASE_SQL_EDITOR.sql` مرة واحدة في قاعدة جديدة ضمن SQL Editor. يفعّل RLS على جداول التطبيق بلا سياسات وصول من المتصفح.
3. في Render: `New > Blueprint` ← مستودع GitHub ← `render.yaml`.
4. ضعي `DATABASE_URL` الخاص بـSupabase **كسرّ في خدمة API**. استخدمي Session pooler على شبكات IPv4؛ لا تضعيه في ملفات المستودع.
5. Redis يُنشأ بواسطة الـBlueprint وتُمرَّر بياناته تلقائيًا إلى API.
6. تحققي من `https://<your-render-web-host>/backend/health` ثم أنشئي مستخدم تجربة.

**ملاحظة مهمة للنشر:** إذا ثُبّتت الجداول مسبقًا في Supabase عبر SQL Editor فلا حاجة لتشغيل `migrate` ثانية. لا تشغلي الترحيل على قاعدة حية قبل النسخ الاحتياطي والاختبار.

## ملفات أساسية

| المسار | المحتوى |
|--|--|
| `web/app/` | واجهة البرنامج |
| `web/app/backend/[...path]/route.ts` | وسيط آمن نسبياً لاتصال الواجهة بخادم API من النطاق نفسه |
| `api/src/server.ts` | الحسابات والقيود والفواتير والتقارير |
| `api/src/rate-limit.ts` | Redis لتحديد محاولات الدخول |
| `api/scripts/migrate.mjs` | تركيب إصدار قاعدة البيانات تدريجيًا |
| `db/*.sql` | الجداول والفهارس والحماية الأولية |
| `render.yaml` | Blueprint خدمة الويب وAPI وRedis |
| `.github/workflows/ci.yml` | اختبارات وبناء تلقائي في GitHub |
| `preview/index.html` | تجربة HTML محلية مستقلة بأرقام افتراضية، ليست الخادم الحقيقي |
| `docs/arabic/` | توثيق وتشغيل والحدود الفنية |

## الاختبارات

```bash
cd api
npm install
npm run test:core
npm run test:deployment
npm run build
cd ../web
npm install
npm run build
```

نفذت في بيئة إعداد الحزمة 45 حالة اختبار محلية نجحت. **لم أتمكن من تنزيل حزم npm أو تشغيل Docker/PostgreSQL حيًا هنا؛ ولذلك لم تُختبر بنية الخادم والتكامل الكاملين بعد.** GitHub Actions سيحاول تشغيل البناء بعد رفع المستودع عبر اتصال GitHub بالإنترنت.

## حدود الإصدار

- المزامنة مع Wafeq/Xero/SMACC ليست جاهزة؛ موجود استقبال مرحلي للسجلات فقط.
- زاتكا: إعداد ملف ضريبي ومحاكاة اختيارية مغلقة؛ **لا يوجد توقيع أو تخليص أو إبلاغ حقيقي أو شهادات مفعلة**.
- لا تتوفر ميزات إنتاجية كاملة مثل الاستعادة المُختبرة، المراجعة الأمنية الخارجية، MFA، إنهاء دورة الضريبة قانونيًا، والفصل القانوني الدقيق بين كل الحالات المحاسبية.
- «جواهر» هو الاسم البرمجي المقترح؛ التحقق من العلامة التجارية قبل الطرح التجاري مطلوب.

**لا ترسلي كلمات مرور Supabase، أو `DATABASE_URL` الفعلي، أو رموز ZATCA إلى المحادثة أو GitHub.**
