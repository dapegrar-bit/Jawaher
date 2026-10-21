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
