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
