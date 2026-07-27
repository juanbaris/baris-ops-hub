
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');
CREATE TYPE public.distributor AS ENUM ('UNFI', 'KeHe', 'Rainforest', 'RFD', 'Direct', 'Other');
CREATE TYPE public.order_status AS ENUM ('Open', 'Acknowledged', 'Shipment', 'Invoiced');
CREATE TYPE public.sku AS ENUM ('XD', 'PW', 'HM', 'WM', 'WD', 'Matcha');
CREATE TYPE public.warehouse AS ENUM ('Lineage Newark', 'Cold Chain', 'Empire', 'Heinlein', 'OOE');
CREATE TYPE public.fp_concept AS ENUM ('Production', 'Sale', 'Sample', 'Damage', 'Transfer', 'Free');
CREATE TYPE public.movement_type AS ENUM ('In', 'Out');
CREATE TYPE public.facility AS ENUM ('Heinlein', 'Empire', 'OOE');
CREATE TYPE public.ip_concept AS ENUM ('Procurement', 'Consumption', 'Damage', 'Transfer');

-- =========================================================
-- SHARED FUNCTIONS
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========================================================
-- USER ROLES (must exist before other RLS policies reference has_role)
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_write()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor');
$$;

CREATE POLICY "user_roles read all signed in" ON public.user_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles admin manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- PROFILES (display names for the 4 named users)
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- DISTRIBUTOR TERMS
-- =========================================================
CREATE TABLE public.distributor_terms (
  distributor public.distributor PRIMARY KEY,
  payment_terms_days INT NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.distributor_terms TO authenticated;
GRANT ALL ON public.distributor_terms TO service_role;
ALTER TABLE public.distributor_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "terms read all" ON public.distributor_terms FOR SELECT TO authenticated USING (true);
CREATE POLICY "terms admin manage" ON public.distributor_terms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.distributor_terms (distributor, payment_terms_days) VALUES
  ('UNFI', 30), ('KeHe', 30), ('RFD', 30), ('Rainforest', 60), ('Direct', 30), ('Other', 30);

-- =========================================================
-- CUSTOMER ORDERS
-- =========================================================
CREATE TABLE public.customer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL,
  po_date DATE NOT NULL,
  ship_est_date DATE,
  invoice_date DATE,
  distributor public.distributor NOT NULL,
  customer TEXT NOT NULL,
  status public.order_status NOT NULL DEFAULT 'Open',
  wd_cases INT, pw_cases INT, hm_cases INT, matcha_cases INT, xd_cases INT, wm_cases INT,
  gross_sales NUMERIC(12,2) DEFAULT 0,
  promo_discount NUMERIC(12,2) DEFAULT 0,
  net_sales NUMERIC(12,2) DEFAULT 0,
  fill_rate NUMERIC(5,4),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  collected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_orders_po_date ON public.customer_orders(po_date DESC);
CREATE INDEX idx_customer_orders_status ON public.customer_orders(status);
CREATE INDEX idx_customer_orders_distributor ON public.customer_orders(distributor);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_orders TO authenticated;
GRANT ALL ON public.customer_orders TO service_role;
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders read" ON public.customer_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "orders write" ON public.customer_orders FOR INSERT TO authenticated
  WITH CHECK (public.can_write());
CREATE POLICY "orders update" ON public.customer_orders FOR UPDATE TO authenticated
  USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "orders delete" ON public.customer_orders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER co_updated BEFORE UPDATE ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- FP MOVEMENTS
-- =========================================================
CREATE TABLE public.fp_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_date DATE NOT NULL,
  type public.movement_type NOT NULL,
  sku public.sku NOT NULL,
  cases INT NOT NULL,
  warehouse public.warehouse NOT NULL,
  lot_number TEXT NOT NULL,
  concept public.fp_concept NOT NULL,
  cogs_per_case NUMERIC(10,4),
  po_number_ref TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fp_movements_date ON public.fp_movements(movement_date DESC);
CREATE INDEX idx_fp_movements_sku_wh ON public.fp_movements(sku, warehouse);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fp_movements TO authenticated;
GRANT ALL ON public.fp_movements TO service_role;
ALTER TABLE public.fp_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fp read" ON public.fp_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "fp write" ON public.fp_movements FOR INSERT TO authenticated
  WITH CHECK (public.can_write());
CREATE POLICY "fp update" ON public.fp_movements FOR UPDATE TO authenticated
  USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "fp delete" ON public.fp_movements FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER fp_updated BEFORE UPDATE ON public.fp_movements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- PRODUCTION RUNS (auto-creates fp_movements In/Production)
-- =========================================================
CREATE TABLE public.production_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  facility public.facility NOT NULL,
  sku public.sku NOT NULL,
  cases_produced INT NOT NULL CHECK (cases_produced > 0),
  cogs_per_case NUMERIC(10,4) NOT NULL,
  lot_number TEXT NOT NULL,
  warehouse public.warehouse NOT NULL DEFAULT 'Lineage Newark',
  notes TEXT,
  fp_movement_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_production_date ON public.production_runs(run_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_runs TO authenticated;
GRANT ALL ON public.production_runs TO service_role;
ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prod read" ON public.production_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "prod write" ON public.production_runs FOR INSERT TO authenticated
  WITH CHECK (public.can_write());
CREATE POLICY "prod update" ON public.production_runs FOR UPDATE TO authenticated
  USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "prod delete" ON public.production_runs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER prod_updated BEFORE UPDATE ON public.production_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.production_to_fp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mv_id UUID;
BEGIN
  INSERT INTO public.fp_movements(movement_date, type, sku, cases, warehouse, lot_number, concept, cogs_per_case, notes, created_by)
  VALUES (NEW.run_date, 'In', NEW.sku, NEW.cases_produced, NEW.warehouse, NEW.lot_number, 'Production', NEW.cogs_per_case, NEW.notes, NEW.created_by)
  RETURNING id INTO mv_id;
  NEW.fp_movement_id := mv_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prod_creates_fp BEFORE INSERT ON public.production_runs
  FOR EACH ROW EXECUTE FUNCTION public.production_to_fp();

-- =========================================================
-- I&P MOVEMENTS
-- =========================================================
CREATE TABLE public.ip_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_date DATE NOT NULL,
  material TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity NUMERIC(12,4) NOT NULL,
  type public.movement_type NOT NULL,
  vendor TEXT,
  concept public.ip_concept NOT NULL,
  lot_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ip_date ON public.ip_movements(movement_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ip_movements TO authenticated;
GRANT ALL ON public.ip_movements TO service_role;
ALTER TABLE public.ip_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ip read" ON public.ip_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "ip write" ON public.ip_movements FOR INSERT TO authenticated
  WITH CHECK (public.can_write());
CREATE POLICY "ip update" ON public.ip_movements FOR UPDATE TO authenticated
  USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "ip delete" ON public.ip_movements FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER ip_updated BEFORE UPDATE ON public.ip_movements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- AUDIT LOG
-- =========================================================
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  table_name TEXT NOT NULL,
  record_id UUID,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_log(created_at DESC);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit read admin" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "audit insert self" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Log status changes on customer_orders
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_data, new_data)
    VALUES (auth.uid(), 'customer_orders', NEW.id, 'status_change',
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status, 'po_number', NEW.po_number));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER co_audit_status AFTER UPDATE ON public.customer_orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();
