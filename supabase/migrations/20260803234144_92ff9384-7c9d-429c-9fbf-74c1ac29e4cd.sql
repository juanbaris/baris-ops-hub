
CREATE TABLE public.logistics_dc_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_customer_name text NOT NULL UNIQUE,
  canonical_dc text,
  quien_cobra_flete text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_dc_mapping TO authenticated;
GRANT ALL ON public.logistics_dc_mapping TO service_role;
ALTER TABLE public.logistics_dc_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dc_mapping read" ON public.logistics_dc_mapping FOR SELECT TO authenticated USING (true);
CREATE POLICY "dc_mapping write" ON public.logistics_dc_mapping FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "dc_mapping update" ON public.logistics_dc_mapping FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "dc_mapping delete" ON public.logistics_dc_mapping FOR DELETE TO authenticated USING (public.can_write());
CREATE TRIGGER dc_mapping_updated BEFORE UPDATE ON public.logistics_dc_mapping FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.logistics_lineage_tariff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_dc text NOT NULL UNIQUE,
  state text,
  plt_1 numeric NOT NULL DEFAULT 0, plt_2 numeric NOT NULL DEFAULT 0, plt_3 numeric NOT NULL DEFAULT 0,
  plt_4 numeric NOT NULL DEFAULT 0, plt_5 numeric NOT NULL DEFAULT 0, plt_6 numeric NOT NULL DEFAULT 0,
  plt_7 numeric NOT NULL DEFAULT 0, plt_8 numeric NOT NULL DEFAULT 0, plt_9 numeric NOT NULL DEFAULT 0,
  plt_10 numeric NOT NULL DEFAULT 0,
  confianza text NOT NULL DEFAULT 'Estimado',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_lineage_tariff TO authenticated;
GRANT ALL ON public.logistics_lineage_tariff TO service_role;
ALTER TABLE public.logistics_lineage_tariff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tariff read" ON public.logistics_lineage_tariff FOR SELECT TO authenticated USING (true);
CREATE POLICY "tariff write" ON public.logistics_lineage_tariff FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "tariff update" ON public.logistics_lineage_tariff FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "tariff delete" ON public.logistics_lineage_tariff FOR DELETE TO authenticated USING (public.can_write());
CREATE TRIGGER tariff_updated BEFORE UPDATE ON public.logistics_lineage_tariff FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.logistics_lineage_surcharges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_surcharge_pct numeric NOT NULL DEFAULT 0.425,
  detention_expected numeric NOT NULL DEFAULT 13.73,
  lumper_expected numeric NOT NULL DEFAULT 20.90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_lineage_surcharges TO authenticated;
GRANT ALL ON public.logistics_lineage_surcharges TO service_role;
ALTER TABLE public.logistics_lineage_surcharges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surcharges read" ON public.logistics_lineage_surcharges FOR SELECT TO authenticated USING (true);
CREATE POLICY "surcharges write" ON public.logistics_lineage_surcharges FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "surcharges update" ON public.logistics_lineage_surcharges FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE TRIGGER surcharges_updated BEFORE UPDATE ON public.logistics_lineage_surcharges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.logistics_kehe_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_dc text NOT NULL UNIQUE,
  cost_per_lb numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_kehe_rate TO authenticated;
GRANT ALL ON public.logistics_kehe_rate TO service_role;
ALTER TABLE public.logistics_kehe_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kehe read" ON public.logistics_kehe_rate FOR SELECT TO authenticated USING (true);
CREATE POLICY "kehe write" ON public.logistics_kehe_rate FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "kehe update" ON public.logistics_kehe_rate FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "kehe delete" ON public.logistics_kehe_rate FOR DELETE TO authenticated USING (public.can_write());
CREATE TRIGGER kehe_updated BEFORE UPDATE ON public.logistics_kehe_rate FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.logistics_accessorial_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_per_shipment numeric NOT NULL DEFAULT 19.50,
  loading_per_pallet numeric NOT NULL DEFAULT 4.00,
  case_picking_per_case numeric NOT NULL DEFAULT 0.35,
  cases_per_pallet integer NOT NULL DEFAULT 255,
  assumed_lb_per_case numeric NOT NULL DEFAULT 3.4,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_accessorial_rates TO authenticated;
GRANT ALL ON public.logistics_accessorial_rates TO service_role;
ALTER TABLE public.logistics_accessorial_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "accessorial read" ON public.logistics_accessorial_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "accessorial write" ON public.logistics_accessorial_rates FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "accessorial update" ON public.logistics_accessorial_rates FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE TRIGGER accessorial_updated BEFORE UPDATE ON public.logistics_accessorial_rates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.logistics_lineage_surcharges (fuel_surcharge_pct, detention_expected, lumper_expected)
VALUES (0.425, 13.73, 20.90);

INSERT INTO public.logistics_accessorial_rates (bol_per_shipment, loading_per_pallet, case_picking_per_case, cases_per_pallet, assumed_lb_per_case)
VALUES (19.50, 4.00, 0.35, 255, 3.4);

INSERT INTO public.logistics_kehe_rate (canonical_dc, cost_per_lb) VALUES
('KeHe Chino', 0.815077), ('KeHe Hialeah', 1.045509), ('KeHe Phoenix', 0.916234),
('KeHe Aurora', 1.271410), ('KeHe Dallas', 0.762042), ('KeHe Maryland', 0.590344),
('KeHe Douglasville', 0.779498), ('KeHe Stockton', 0.929053), ('KeHe Ellettsville', 1.140213),
('KeHe Portland', 1.004617);

INSERT INTO public.logistics_lineage_tariff (canonical_dc, state, plt_1, plt_2, plt_3, plt_4, plt_5, plt_6, plt_7, plt_8, plt_9, plt_10, confianza) VALUES
('UNFI Moreno Valley','CA',417.68,300.81,258.70,258.70,258.70,224.97,224.97,224.97,224.97,224.97,'Real'),
('UNFI Rocklin','CA',417.68,307.09,264.10,264.10,264.10,229.61,229.61,229.61,229.61,229.61,'Real'),
('UNFI Ridgefield','WA',417.68,323.89,278.54,278.54,278.54,242.21,242.21,242.21,242.21,242.21,'Real'),
('UNFI Sarasota','FL',404.04,274.08,235.71,235.71,213.15,196.31,196.31,196.31,196.31,196.31,'Real'),
('UNFI Iowa City','IA',404.04,204.59,175.95,175.95,162.40,145.23,145.23,145.23,145.23,145.23,'Real'),
('UNFI Greenwood','IN',404.04,202.02,173.74,173.74,139.10,119.63,119.63,119.63,119.63,119.63,'Real'),
('UNFI Hudson Valley','NY',264.08,171.65,171.65,171.65,163.19,140.35,140.35,140.35,140.35,140.35,'Real'),
('UNFI Racine','WI',404.04,202.02,173.74,173.74,151.47,130.27,130.27,130.27,130.27,130.27,'Real'),
('UNFI Lancaster (Dallas)','TX',404.04,250.57,222.34,222.34,205.18,176.46,176.46,176.46,176.46,176.46,'Real'),
('UNFI Manchester','PA',222.77,144.80,144.80,144.80,134.39,115.57,115.57,115.57,115.57,115.57,'Real'),
('UNFI York','PA',222.77,144.80,144.80,144.80,134.39,115.57,115.57,115.57,115.57,115.57,'Real'),
('Rainforest Bayonne/NJ','NJ',253.81,164.97,164.97,164.97,155.95,134.12,134.12,134.12,134.12,134.12,'Real'),
('Rainforest Maryland/Frederick','MD',222.77,144.80,144.80,144.80,134.39,115.57,115.57,115.57,115.57,115.57,'Real'),
('UNFI Chesterfield','NH',320.38,208.25,208.25,208.25,197.98,170.27,170.27,170.27,170.27,170.27,'Estimado'),
('UNFI Dayville','CT',240.29,156.18,156.18,156.18,148.49,127.70,127.70,127.70,127.70,127.70,'Estimado'),
('UNFI Joliet','IL',469.99,235.00,202.10,202.10,161.81,139.16,139.16,139.16,139.16,139.16,'Estimado'),
('UNFI Twin Cities','MN',734.36,367.18,315.78,315.78,252.82,217.43,217.43,217.43,217.43,217.43,'Estimado');

INSERT INTO public.logistics_dc_mapping (raw_customer_name, canonical_dc, quien_cobra_flete) VALUES
('UNFI RACINE WAREHOUSE','UNFI Racine','Lineage'),
('UNFI EAST - RACINE WAREHOUSE','UNFI Racine','Lineage'),
('UNFI EAST- GREENWOOD','UNFI Greenwood','Lineage'),
('UNFI EAST - GREENWOOD','UNFI Greenwood','Lineage'),
('UNFI - HUDSON VALLEY','UNFI Hudson Valley','Lineage'),
('UNFI - IOWA CITY','UNFI Iowa City','Lineage'),
('UNFI MORENO VALLEY','UNFI Moreno Valley','Lineage'),
('UNFI MANCHESTER','UNFI Manchester','Lineage'),
('UNFI / MILLBROOK (YORK DC)','UNFI York','Lineage'),
('UNFI TWIN CITIES','UNFI Twin Cities','Lineage'),
('UNFI TWIN CITIES WAREHOUSE','UNFI Twin Cities','Lineage'),
('UNFI PRESCOTT DISTRIBUTION','UNFI Twin Cities','Lineage'),
('UNFI JOLIET','UNFI Joliet','Lineage'),
('UNFI (JOLIET WAREHOUSE)','UNFI Joliet','Lineage'),
('RAINFOREST DISTRIBUTION','Rainforest Bayonne/NJ','Lineage'),
('RAINFOREST DISTRIBUTION CORP','Rainforest Bayonne/NJ','Lineage'),
('RAINFOREST','Rainforest Bayonne/NJ','Lineage'),
('KeHe 16','KeHe Ellettsville','KeHe FOB'),
('Kehe 16','KeHe Ellettsville','KeHe FOB'),
('Kehe Indiana','KeHe Ellettsville','KeHe FOB'),
('KeHe Arizona','KeHe Phoenix','KeHe FOB'),
('Kehe Phoenix','KeHe Phoenix','KeHe FOB'),
('Kehe Chino','KeHe Chino','KeHe FOB'),
('Kehe Colorado','KeHe Aurora','KeHe FOB'),
('Kehe Aurora','KeHe Aurora','KeHe FOB'),
('Kehe Florida','KeHe Hialeah','KeHe FOB'),
('Kehe Stockton','KeHe Stockton','KeHe FOB'),
('KeHe Stockon','KeHe Stockton','KeHe FOB'),
('Kehe Dallas','KeHe Dallas','KeHe FOB'),
('Kehe Douglasville','KeHe Douglasville','KeHe FOB'),
('Kehe Georgia','KeHe Douglasville','KeHe FOB'),
('Kehe MD','KeHe Maryland','KeHe FOB'),
('Kehe Maryland','KeHe Maryland','KeHe FOB'),
('Kehe Oregon','KeHe Portland','KeHe FOB'),
('Kehe Portland','KeHe Portland','KeHe FOB'),
('UNFI - WEST',NULL,NULL),
('UNFI - 21ST STREET',NULL,NULL),
('UNFI SUPERVALU',NULL,NULL),
('UNFI- EAST',NULL,NULL),
('JMM Distributors',NULL,NULL),
('BARIS C/O COLD CHAIN 3PL',NULL,NULL),
('EMPIRE FREEZING AND DRYING',NULL,NULL);
