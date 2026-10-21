-- جواهر ميزان | Supabase Database Setup v2
-- Execute only in a new or backed-up Supabase project using SQL Editor; test first.

-- ===== 001_init.sql =====
-- JAWAHER MIZAN v0.1 - starter schema for an SAR-only pilot, NOT a ZATCA production ledger.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_exp_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL, currency char(3) NOT NULL DEFAULT 'SAR' CHECK (currency='SAR'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id, tenant_id)
);
CREATE TABLE IF NOT EXISTS memberships (
 company_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES app_users(id),
 role text NOT NULL CHECK (role IN ('owner','accountant','viewer')),
 PRIMARY KEY(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS fiscal_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 title text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 CHECK(ends_on>=starts_on), UNIQUE(id,company_id)
);
CREATE TABLE IF NOT EXISTS accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 code text NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('asset','liability','equity','income','expense')),
 postable boolean NOT NULL DEFAULT true, active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,code), UNIQUE(id, company_id)
);
CREATE TABLE IF NOT EXISTS journal_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 period_id uuid NOT NULL, entry_date date NOT NULL, memo text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
 idempotency_key text NOT NULL, created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
 UNIQUE(company_id,idempotency_key), UNIQUE(id,company_id),
 FOREIGN KEY(period_id,company_id) REFERENCES fiscal_periods(id,company_id)
);
CREATE TABLE IF NOT EXISTS journal_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 entry_id uuid NOT NULL, account_id uuid NOT NULL,
 debit numeric(18,2) NOT NULL DEFAULT 0, credit numeric(18,2) NOT NULL DEFAULT 0,
 CHECK(debit>=0 AND credit>=0),
 CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),
 FOREIGN KEY(entry_id,company_id) REFERENCES journal_entries(id,company_id),
 FOREIGN KEY(account_id,company_id) REFERENCES accounts(id,company_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 actor_id uuid NOT NULL REFERENCES app_users(id), event text NOT NULL,
 object_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_company_date_idx ON journal_entries(company_id,entry_date DESC);
CREATE INDEX IF NOT EXISTS lines_entry_idx ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS audit_company_date_idx ON audit_events(company_id,created_at DESC);

-- Block edits to already posted journal entries / posted entry lines even by a buggy API.
CREATE OR REPLACE FUNCTION jawaher_protect_posted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entry uuid;
BEGIN
 IF TG_TABLE_NAME = 'journal_entries' THEN
   IF OLD.status = 'posted' THEN
     RAISE EXCEPTION 'Posted journal entries are immutable';
   END IF;
 ELSE
   IF TG_OP = 'INSERT' THEN target_entry := NEW.entry_id;
   ELSE target_entry := OLD.entry_id; END IF;
   IF EXISTS (SELECT 1 FROM journal_entries WHERE id=target_entry AND status='posted') THEN
     RAISE EXCEPTION 'Posted journal lines are immutable';
   END IF;
   IF TG_OP='UPDATE' THEN
     IF EXISTS (SELECT 1 FROM journal_entries WHERE id=NEW.entry_id AND status='posted') THEN
       RAISE EXCEPTION 'Cannot move a line into a posted entry';
     END IF;
   END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
DROP TRIGGER IF EXISTS posted_entry_immutability ON journal_entries;
CREATE TRIGGER posted_entry_immutability BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION jawaher_protect_posted();
DROP TRIGGER IF EXISTS posted_lines_immutability ON journal_lines;
CREATE TRIGGER posted_lines_immutability BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION jawaher_protect_posted();

-- A DB-level deferred invariant: posted entries must be balanced and have >= 2 lines.
CREATE OR REPLACE FUNCTION jawaher_check_posted_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric(24,2); c numeric(24,2); n integer;
BEGIN
 IF NEW.status = 'posted' THEN
   SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d,c,n
   FROM journal_lines WHERE entry_id = NEW.id;
   IF n < 2 OR d <> c OR d <= 0 THEN
     RAISE EXCEPTION 'Posted journal must contain balanced lines';
   END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS check_posted_balance ON journal_entries;
CREATE CONSTRAINT TRIGGER check_posted_balance AFTER INSERT OR UPDATE ON journal_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION jawaher_check_posted_balance();

-- ===== 002_commerce.sql =====
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

-- ===== 003_zatca_preparation.sql =====
-- JAWAHER MIZAN - ZATCA PHASE-2 PREPARATION (NOT production-certified)
-- Apply once after 001_init.sql and 002_commerce.sql; do not delete existing records.
CREATE TABLE IF NOT EXISTS zatca_profiles (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  legal_name text NOT NULL, vat_number varchar(15) NOT NULL,
  cr_number varchar(30), building_number varchar(4) NOT NULL,
  street varchar(180) NOT NULL, district varchar(180) NOT NULL,
  city varchar(120) NOT NULL, postal_code varchar(5) NOT NULL,
  country_code varchar(2) NOT NULL DEFAULT 'SA', device_label varchar(120) NOT NULL,
  updated_by uuid NOT NULL REFERENCES app_users(id), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(vat_number ~ '^3[0-9]{13}3$'),
  CHECK(building_number ~ '^[0-9]{4}$'),
  CHECK(postal_code ~ '^[0-9]{5}$'),
  CHECK(country_code = 'SA')
);
CREATE TABLE IF NOT EXISTS zatca_document_preparations (
  company_id uuid NOT NULL REFERENCES companies(id),
  document_id uuid NOT NULL,
  invoice_category varchar(14) NOT NULL CHECK(invoice_category IN ('standard','simplified')),
  prepared_by uuid NOT NULL REFERENCES app_users(id),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,document_id),
  FOREIGN KEY(document_id,company_id) REFERENCES business_documents(id,company_id)
);
-- No certificates, OTP, private keys, CSID tokens, XML or customer PII are stored in this log.
CREATE TABLE IF NOT EXISTS zatca_simulation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_id uuid NOT NULL,
  operation varchar(30) NOT NULL CHECK(operation IN ('clearance','reporting','complianceInvoices')),
  invoice_uuid uuid NOT NULL,
  envelope_fingerprint varchar(64) NOT NULL,
  http_status integer NOT NULL CHECK(http_status BETWEEN 100 AND 599),
  outcome varchar(16) NOT NULL CHECK(outcome IN ('accepted','rejected','warning','unknown')),
  requested_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(document_id,company_id) REFERENCES business_documents(id,company_id)
);
CREATE INDEX IF NOT EXISTS zatca_attempts_company_idx ON zatca_simulation_attempts(company_id,created_at DESC);

CREATE TABLE IF NOT EXISTS jawaher_schema_migrations(name text PRIMARY KEY,executed_at timestamptz NOT NULL DEFAULT now());
-- ===== 004_supabase_hardening.sql =====
-- Jawaher Mizan: deny direct browser Data API access by enabling RLS with no policies.
-- The NestJS backend uses a privileged server-only database account, not the Supabase anon key.
-- This does NOT replace the backend per-company authorization checks.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_document_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_simulation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jawaher_schema_migrations ENABLE ROW LEVEL SECURITY;

INSERT INTO jawaher_schema_migrations(name) VALUES ('001_init.sql'),('002_commerce.sql'),('003_zatca_preparation.sql'),('004_supabase_hardening.sql') ON CONFLICT DO NOTHING;
