-- JAWAHER MIZAN v1.0 - optional accounting workflow demo, not ZATCA clearance.
CREATE TABLE IF NOT EXISTS contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 name varchar(180) NOT NULL, kind varchar(12) NOT NULL CHECK (kind IN ('customer','supplier','both')),
 email varchar(250), phone varchar(30), tax_number varchar(35), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id, company_id)
);
CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts(company_id,kind,name);
CREATE TABLE IF NOT EXISTS catalog_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 sku varchar(48), name varchar(180) NOT NULL, kind varchar(15) NOT NULL CHECK (kind IN ('service','product')),
 unit varchar(25) NOT NULL DEFAULT 'وحدة', price numeric(18,2) NOT NULL DEFAULT 0 CHECK(price>=0),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,company_id), UNIQUE(company_id,sku)
);
CREATE TABLE IF NOT EXISTS business_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 document_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 kind varchar(12) NOT NULL CHECK (kind IN ('sale','purchase')),
 contact_id uuid NOT NULL, period_id uuid NOT NULL,
 issue_date date NOT NULL, due_date date NOT NULL, reference varchar(160),
 status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partial','paid')),
 subtotal numeric(18,2) NOT NULL CHECK(subtotal>=0),
 vat_total numeric(18,2) NOT NULL CHECK(vat_total>=0),
 grand_total numeric(18,2) NOT NULL CHECK(grand_total>0),
 paid_total numeric(18,2) NOT NULL DEFAULT 0 CHECK(paid_total>=0),
 journal_id uuid, created_by uuid NOT NULL REFERENCES app_users(id),
 idempotency_key varchar(150) NOT NULL,
 zatca_status varchar(30) NOT NULL DEFAULT 'not_connected',
 created_at timestamptz NOT NULL DEFAULT now(), issued_at timestamptz,
 UNIQUE(id,company_id), UNIQUE(company_id,kind,idempotency_key),
 FOREIGN KEY(contact_id,company_id) REFERENCES contacts(id,company_id),
 FOREIGN KEY(period_id,company_id) REFERENCES fiscal_periods(id,company_id),
 FOREIGN KEY(journal_id,company_id) REFERENCES journal_entries(id,company_id),
 CHECK(paid_total<=grand_total), CHECK(due_date>=issue_date)
);
CREATE INDEX IF NOT EXISTS docs_company_type_idx ON business_documents(company_id,kind,created_at DESC);
CREATE TABLE IF NOT EXISTS document_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 document_id uuid NOT NULL, description varchar(500) NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 unit_price numeric(18,2) NOT NULL CHECK(unit_price>=0),
 tax_rate integer NOT NULL CHECK(tax_rate IN (0,15)),
 line_subtotal numeric(18,2) NOT NULL CHECK(line_subtotal>=0),
 line_tax numeric(18,2) NOT NULL CHECK(line_tax>=0),
 FOREIGN KEY(document_id,company_id) REFERENCES business_documents(id,company_id)
);
CREATE INDEX IF NOT EXISTS doc_lines_parent_idx ON document_lines(document_id);
CREATE TABLE IF NOT EXISTS document_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
 document_id uuid NOT NULL,journal_id uuid NOT NULL,
 paid_on date NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount>0),
 created_by uuid NOT NULL REFERENCES app_users(id), idempotency_key varchar(150) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,idempotency_key),
 FOREIGN KEY(document_id,company_id) REFERENCES business_documents(id,company_id),
 FOREIGN KEY(journal_id,company_id) REFERENCES journal_entries(id,company_id)
);
CREATE TABLE IF NOT EXISTS integration_staging (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
 provider varchar(32) NOT NULL, external_id varchar(180) NOT NULL,
 record_type varchar(32) NOT NULL, payload jsonb NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','reviewed','rejected')),
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,provider,external_id,record_type)
);
CREATE INDEX IF NOT EXISTS staging_company_idx ON integration_staging(company_id,created_at DESC);
-- These additions define demo records only. Stock ledgers, multi-currency, tax exemptions,
-- credit notes and ZATCA onboarding must be engineered separately before production use.
INSERT INTO accounts(company_id,code,name,kind)
SELECT id,'1400','ضريبة مدخلات قابلة للخصم','asset' FROM companies
ON CONFLICT (company_id,code) DO NOTHING;
