CREATE TABLE public.logistics_forecast_distributor_mix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor text NOT NULL UNIQUE,
  mix_pct numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_forecast_distributor_mix TO authenticated;
GRANT ALL ON public.logistics_forecast_distributor_mix TO service_role;
ALTER TABLE public.logistics_forecast_distributor_mix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fdm read" ON public.logistics_forecast_distributor_mix FOR SELECT TO authenticated USING (true);
CREATE POLICY "fdm write" ON public.logistics_forecast_distributor_mix FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "fdm update" ON public.logistics_forecast_distributor_mix FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "fdm delete" ON public.logistics_forecast_distributor_mix FOR DELETE TO authenticated USING (public.can_write());
CREATE TRIGGER fdm_updated BEFORE UPDATE ON public.logistics_forecast_distributor_mix FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.logistics_forecast_dc_mix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor text NOT NULL,
  canonical_dc text NOT NULL,
  mix_pct numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (distributor, canonical_dc)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_forecast_dc_mix TO authenticated;
GRANT ALL ON public.logistics_forecast_dc_mix TO service_role;
ALTER TABLE public.logistics_forecast_dc_mix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fdcm read" ON public.logistics_forecast_dc_mix FOR SELECT TO authenticated USING (true);
CREATE POLICY "fdcm write" ON public.logistics_forecast_dc_mix FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "fdcm update" ON public.logistics_forecast_dc_mix FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "fdcm delete" ON public.logistics_forecast_dc_mix FOR DELETE TO authenticated USING (public.can_write());
CREATE TRIGGER fdcm_updated BEFORE UPDATE ON public.logistics_forecast_dc_mix FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.logistics_forecast_shipment_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_dc text NOT NULL UNIQUE,
  avg_cases_per_shipment numeric NOT NULL DEFAULT 0,
  avg_cost_per_shipment numeric NOT NULL DEFAULT 0,
  shipment_sample integer NOT NULL DEFAULT 0,
  flete_pct numeric NOT NULL DEFAULT 0.8,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_forecast_shipment_profile TO authenticated;
GRANT ALL ON public.logistics_forecast_shipment_profile TO service_role;
ALTER TABLE public.logistics_forecast_shipment_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fsp read" ON public.logistics_forecast_shipment_profile FOR SELECT TO authenticated USING (true);
CREATE POLICY "fsp write" ON public.logistics_forecast_shipment_profile FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "fsp update" ON public.logistics_forecast_shipment_profile FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "fsp delete" ON public.logistics_forecast_shipment_profile FOR DELETE TO authenticated USING (public.can_write());
CREATE TRIGGER fsp_updated BEFORE UPDATE ON public.logistics_forecast_shipment_profile FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.logistics_forecast_distributor_mix (distributor, mix_pct) VALUES
  ('KeHe', 0.55), ('UNFI', 0.28), ('Rainforest', 0.10), ('RFD', 0.07);

INSERT INTO public.logistics_forecast_dc_mix (distributor, canonical_dc, mix_pct) VALUES
  ('UNFI','UNFI Racine',0.195),('UNFI','UNFI Manchester',0.174),('UNFI','UNFI Hudson Valley',0.106),
  ('UNFI','UNFI Moreno Valley',0.103),('UNFI','UNFI Sarasota',0.083),('UNFI','UNFI Joliet',0.080),
  ('UNFI','UNFI Rocklin',0.065),('UNFI','UNFI Twin Cities',0.051),('UNFI','UNFI Iowa City',0.032),
  ('UNFI','UNFI Greenwood',0.032),('UNFI','UNFI Lancaster (Dallas)',0.020),('UNFI','UNFI York',0.018),
  ('UNFI','UNFI Dayville',0.015),('UNFI','UNFI Ridgefield',0.013),('UNFI','UNFI Chesterfield',0.013),
  ('Rainforest','Rainforest Bayonne/NJ',0.768),('Rainforest','Rainforest Maryland/Frederick',0.232),
  ('RFD','Rainforest Bayonne/NJ',0.768),('RFD','Rainforest Maryland/Frederick',0.232),
  ('KeHe','KeHe Chino',0.310),('KeHe','KeHe Dallas',0.115),('KeHe','KeHe Stockton',0.111),
  ('KeHe','KeHe Hialeah',0.101),('KeHe','KeHe Phoenix',0.095),('KeHe','KeHe Aurora',0.088),
  ('KeHe','KeHe Maryland',0.075),('KeHe','KeHe Douglasville',0.057),('KeHe','KeHe Ellettsville',0.032),
  ('KeHe','KeHe Portland',0.016);

INSERT INTO public.logistics_forecast_shipment_profile (canonical_dc, avg_cases_per_shipment, avg_cost_per_shipment, shipment_sample, flete_pct) VALUES
  ('KeHe Ellettsville',81,1040.28,8,0.9500),
  ('KeHe Aurora',249,1370.86,7,0.9193),
  ('KeHe Chino',617,2367.43,10,0.8955),
  ('KeHe Dallas',285,1199.37,8,0.8939),
  ('KeHe Douglasville',163,756.37,7,0.8935),
  ('KeHe Hialeah',182,1159.32,11,0.9248),
  ('KeHe Maryland',148,638.89,10,0.8821),
  ('KeHe Phoenix',270,1140.48,7,0.8930),
  ('KeHe Portland',158,949.63,2,0.9170),
  ('KeHe Stockton',276,1330.20,8,0.9067),
  ('Rainforest Bayonne/NJ',612,536.23,20,0.5418),
  ('Rainforest Maryland/Frederick',369,463.08,10,0.6617),
  ('UNFI Chesterfield',165,572.42,2,0.8581),
  ('UNFI Dayville',200,470.37,2,0.8012),
  ('UNFI Greenwood',92,665.97,9,0.9164),
  ('UNFI Hudson Valley',198,503.84,14,0.8158),
  ('UNFI Iowa City',104,635.26,8,0.9057),
  ('UNFI Joliet',299,725.63,7,0.8179),
  ('UNFI Lancaster (Dallas)',88,664.51,6,0.9183),
  ('UNFI Manchester',379,481.76,12,0.6676),
  ('UNFI Moreno Valley',134,700.31,20,0.8995),
  ('UNFI Racine',318,667.30,16,0.7920),
  ('UNFI Ridgefield',115,693.57,3,0.9081),
  ('UNFI Rocklin',142,703.02,12,0.8959),
  ('UNFI Sarasota',155,688.01,14,0.8870),
  ('UNFI Twin Cities',95,1137.89,14,0.9500),
  ('UNFI York',480,436.47,1,0.5521);