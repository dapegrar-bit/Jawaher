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
