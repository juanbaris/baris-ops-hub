-- 1. bol_lines: enable RLS + grants + policies
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bol_lines TO authenticated;
GRANT ALL ON public.bol_lines TO service_role;
ALTER TABLE public.bol_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bol_lines_select ON public.bol_lines;
CREATE POLICY bol_lines_select ON public.bol_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bol_lines_insert ON public.bol_lines;
CREATE POLICY bol_lines_insert ON public.bol_lines FOR INSERT TO authenticated WITH CHECK (public.can_write());
DROP POLICY IF EXISTS bol_lines_update ON public.bol_lines;
CREATE POLICY bol_lines_update ON public.bol_lines FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
DROP POLICY IF EXISTS bol_lines_delete ON public.bol_lines;
CREATE POLICY bol_lines_delete ON public.bol_lines FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2. po-attachments storage: require write role for mutations
DROP POLICY IF EXISTS po_attachments_insert ON storage.objects;
CREATE POLICY po_attachments_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'po-attachments' AND public.can_write());
DROP POLICY IF EXISTS po_attachments_update ON storage.objects;
CREATE POLICY po_attachments_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'po-attachments' AND public.can_write())
  WITH CHECK (bucket_id = 'po-attachments' AND public.can_write());
DROP POLICY IF EXISTS po_attachments_delete ON storage.objects;
CREATE POLICY po_attachments_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'po-attachments' AND public.can_write());

-- 3. profiles: own profile or admin
DROP POLICY IF EXISTS "profiles read all" ON public.profiles;
CREATE POLICY "profiles read own or admin" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 4. user_roles: own role or admin
DROP POLICY IF EXISTS "user_roles read all signed in" ON public.user_roles;
CREATE POLICY "user_roles read own or admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 5. Trigger-only SECURITY DEFINER functions must not be API-callable
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.log_order_status_change() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.production_to_fp() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE ALL ON FUNCTION public.can_write() FROM anon;
REVOKE ALL ON FUNCTION public.current_user_role() FROM anon;