export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bol_lines: {
        Row: {
          bol_date: string
          bol_number: string
          cases_shipped: number
          created_at: string | null
          exp_date: string | null
          fp_movement_id: string | null
          id: string
          item_number: string | null
          lot_number: string
          order_id: string
          po_number: string
          sku: string
          warehouse: string | null
        }
        Insert: {
          bol_date: string
          bol_number: string
          cases_shipped: number
          created_at?: string | null
          exp_date?: string | null
          fp_movement_id?: string | null
          id?: string
          item_number?: string | null
          lot_number: string
          order_id: string
          po_number: string
          sku: string
          warehouse?: string | null
        }
        Update: {
          bol_date?: string
          bol_number?: string
          cases_shipped?: number
          created_at?: string | null
          exp_date?: string | null
          fp_movement_id?: string | null
          id?: string
          item_number?: string | null
          lot_number?: string
          order_id?: string
          po_number?: string
          sku?: string
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bol_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_lines: {
        Row: {
          budget_gross: number | null
          budget_net: number | null
          created_at: string | null
          id: string
          month: string
          month_num: number
          updated_at: string | null
          year: number
        }
        Insert: {
          budget_gross?: number | null
          budget_net?: number | null
          created_at?: string | null
          id?: string
          month: string
          month_num: number
          updated_at?: string | null
          year: number
        }
        Update: {
          budget_gross?: number | null
          budget_net?: number | null
          created_at?: string | null
          id?: string
          month?: string
          month_num?: number
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      customer_orders: {
        Row: {
          bol_date: string | null
          bol_number: string | null
          case_value: number | null
          collected_at: string | null
          created_at: string
          created_by: string | null
          customer: string
          distributor: Database["public"]["Enums"]["distributor"]
          fill_rate: number | null
          gross_sales: number | null
          hm_cases: number | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoiced_at: string | null
          matcha_cases: number | null
          net_sales: number | null
          notes: string | null
          po_date: string
          po_number: string
          promo_discount: number | null
          pw_cases: number | null
          ship_est_date: string | null
          ship_to_address: string | null
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          wd_cases: number | null
          wm_cases: number | null
          xd_cases: number | null
        }
        Insert: {
          bol_date?: string | null
          bol_number?: string | null
          case_value?: number | null
          collected_at?: string | null
          created_at?: string
          created_by?: string | null
          customer: string
          distributor: Database["public"]["Enums"]["distributor"]
          fill_rate?: number | null
          gross_sales?: number | null
          hm_cases?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoiced_at?: string | null
          matcha_cases?: number | null
          net_sales?: number | null
          notes?: string | null
          po_date: string
          po_number: string
          promo_discount?: number | null
          pw_cases?: number | null
          ship_est_date?: string | null
          ship_to_address?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          wd_cases?: number | null
          wm_cases?: number | null
          xd_cases?: number | null
        }
        Update: {
          bol_date?: string | null
          bol_number?: string | null
          case_value?: number | null
          collected_at?: string | null
          created_at?: string
          created_by?: string | null
          customer?: string
          distributor?: Database["public"]["Enums"]["distributor"]
          fill_rate?: number | null
          gross_sales?: number | null
          hm_cases?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoiced_at?: string | null
          matcha_cases?: number | null
          net_sales?: number | null
          notes?: string | null
          po_date?: string
          po_number?: string
          promo_discount?: number | null
          pw_cases?: number | null
          ship_est_date?: string | null
          ship_to_address?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          wd_cases?: number | null
          wm_cases?: number | null
          xd_cases?: number | null
        }
        Relationships: []
      }
      dc_inventory: {
        Row: {
          at_risk: boolean | null
          cases_on_hand: number
          cases_on_po: number
          cases_on_so: number
          created_at: string | null
          dc: string
          distributor: string
          id: string
          sku: string
          snapshot_date: string
          weeks_on_hand: number | null
        }
        Insert: {
          at_risk?: boolean | null
          cases_on_hand?: number
          cases_on_po?: number
          cases_on_so?: number
          created_at?: string | null
          dc: string
          distributor: string
          id?: string
          sku: string
          snapshot_date?: string
          weeks_on_hand?: number | null
        }
        Update: {
          at_risk?: boolean | null
          cases_on_hand?: number
          cases_on_po?: number
          cases_on_so?: number
          created_at?: string | null
          dc?: string
          distributor?: string
          id?: string
          sku?: string
          snapshot_date?: string
          weeks_on_hand?: number | null
        }
        Relationships: []
      }
      distributor_terms: {
        Row: {
          distributor: Database["public"]["Enums"]["distributor"]
          payment_terms_days: number
          updated_at: string
        }
        Insert: {
          distributor: Database["public"]["Enums"]["distributor"]
          payment_terms_days?: number
          updated_at?: string
        }
        Update: {
          distributor?: Database["public"]["Enums"]["distributor"]
          payment_terms_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      finance_actuals: {
        Row: {
          ap: number | null
          ar: number | null
          bs_detail: Json | null
          business_contribution: number | null
          capital_contrib: number | null
          cash: number | null
          cash_bop: number | null
          cash_eop: number | null
          cash_from_ops: number | null
          chg_ap: number | null
          chg_ar: number | null
          chg_cash: number | null
          chg_inventory: number | null
          chg_wc: number | null
          cogs: number | null
          commercial_debt: number | null
          distr_fees: number | null
          ebitda: number | null
          freight_out: number | null
          gen_exp: number | null
          gm_pct: number | null
          gross_margin: number | null
          gross_sales: number | null
          id: string
          inventory: number | null
          mkt_trade: number | null
          net_sales: number | null
          other_income: number | null
          period: string
          period_label: string | null
          pnl_detail: Json | null
          selling_exp: number | null
          source: string | null
          storage: number | null
          team: number | null
          total_assets: number | null
          total_equity: number | null
          total_liab: number | null
          trade_spend: number | null
          units_sold: number | null
          uploaded_at: string | null
        }
        Insert: {
          ap?: number | null
          ar?: number | null
          bs_detail?: Json | null
          business_contribution?: number | null
          capital_contrib?: number | null
          cash?: number | null
          cash_bop?: number | null
          cash_eop?: number | null
          cash_from_ops?: number | null
          chg_ap?: number | null
          chg_ar?: number | null
          chg_cash?: number | null
          chg_inventory?: number | null
          chg_wc?: number | null
          cogs?: number | null
          commercial_debt?: number | null
          distr_fees?: number | null
          ebitda?: number | null
          freight_out?: number | null
          gen_exp?: number | null
          gm_pct?: number | null
          gross_margin?: number | null
          gross_sales?: number | null
          id?: string
          inventory?: number | null
          mkt_trade?: number | null
          net_sales?: number | null
          other_income?: number | null
          period: string
          period_label?: string | null
          pnl_detail?: Json | null
          selling_exp?: number | null
          source?: string | null
          storage?: number | null
          team?: number | null
          total_assets?: number | null
          total_equity?: number | null
          total_liab?: number | null
          trade_spend?: number | null
          units_sold?: number | null
          uploaded_at?: string | null
        }
        Update: {
          ap?: number | null
          ar?: number | null
          bs_detail?: Json | null
          business_contribution?: number | null
          capital_contrib?: number | null
          cash?: number | null
          cash_bop?: number | null
          cash_eop?: number | null
          cash_from_ops?: number | null
          chg_ap?: number | null
          chg_ar?: number | null
          chg_cash?: number | null
          chg_inventory?: number | null
          chg_wc?: number | null
          cogs?: number | null
          commercial_debt?: number | null
          distr_fees?: number | null
          ebitda?: number | null
          freight_out?: number | null
          gen_exp?: number | null
          gm_pct?: number | null
          gross_margin?: number | null
          gross_sales?: number | null
          id?: string
          inventory?: number | null
          mkt_trade?: number | null
          net_sales?: number | null
          other_income?: number | null
          period?: string
          period_label?: string | null
          pnl_detail?: Json | null
          selling_exp?: number | null
          source?: string | null
          storage?: number | null
          team?: number | null
          total_assets?: number | null
          total_equity?: number | null
          total_liab?: number | null
          trade_spend?: number | null
          units_sold?: number | null
          uploaded_at?: string | null
        }
        Relationships: []
      }
      finance_assumptions: {
        Row: {
          auto_calculated_value: number | null
          is_manual_override: boolean
          key: string
          label: string
          notes: string | null
          unit: string
          updated_at: string
          value: number
        }
        Insert: {
          auto_calculated_value?: number | null
          is_manual_override?: boolean
          key: string
          label: string
          notes?: string | null
          unit?: string
          updated_at?: string
          value: number
        }
        Update: {
          auto_calculated_value?: number | null
          is_manual_override?: boolean
          key?: string
          label?: string
          notes?: string | null
          unit?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      fp_movements: {
        Row: {
          cases: number
          cogs_per_case: number | null
          concept: Database["public"]["Enums"]["fp_concept"]
          created_at: string
          created_by: string | null
          id: string
          lot_number: string
          movement_date: string
          notes: string | null
          po_number_ref: string | null
          po_ref: string | null
          sku: Database["public"]["Enums"]["sku"]
          type: Database["public"]["Enums"]["movement_type"]
          updated_at: string
          warehouse: Database["public"]["Enums"]["warehouse"]
        }
        Insert: {
          cases: number
          cogs_per_case?: number | null
          concept: Database["public"]["Enums"]["fp_concept"]
          created_at?: string
          created_by?: string | null
          id?: string
          lot_number: string
          movement_date: string
          notes?: string | null
          po_number_ref?: string | null
          po_ref?: string | null
          sku: Database["public"]["Enums"]["sku"]
          type: Database["public"]["Enums"]["movement_type"]
          updated_at?: string
          warehouse: Database["public"]["Enums"]["warehouse"]
        }
        Update: {
          cases?: number
          cogs_per_case?: number | null
          concept?: Database["public"]["Enums"]["fp_concept"]
          created_at?: string
          created_by?: string | null
          id?: string
          lot_number?: string
          movement_date?: string
          notes?: string | null
          po_number_ref?: string | null
          po_ref?: string | null
          sku?: Database["public"]["Enums"]["sku"]
          type?: Database["public"]["Enums"]["movement_type"]
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse"]
        }
        Relationships: []
      }
      fp_stock_baseline: {
        Row: {
          baseline_date: string
          cases: number
          cases_available: number | null
          cogs_per_case: number | null
          created_at: string | null
          expiry_date: string | null
          id: string
          lot_number: string | null
          notes: string | null
          pallet_id: string | null
          sku: string
          warehouse: string
        }
        Insert: {
          baseline_date: string
          cases?: number
          cases_available?: number | null
          cogs_per_case?: number | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          lot_number?: string | null
          notes?: string | null
          pallet_id?: string | null
          sku: string
          warehouse?: string
        }
        Update: {
          baseline_date?: string
          cases?: number
          cases_available?: number | null
          cogs_per_case?: number | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          lot_number?: string | null
          notes?: string | null
          pallet_id?: string | null
          sku?: string
          warehouse?: string
        }
        Relationships: []
      }
      ip_movements: {
        Row: {
          actual_payment_date: string | null
          actual_receive_date: string | null
          cogs_per_unit: number | null
          concept: Database["public"]["Enums"]["ip_concept"]
          created_at: string
          created_by: string | null
          estimated_payment_date: string | null
          estimated_receive_date: string | null
          id: string
          lot_number: string | null
          material: string
          movement_date: string
          notes: string | null
          other_costs: number | null
          paid: boolean | null
          price_per_unit: number | null
          quantity: number
          received: boolean | null
          shipping_price: number | null
          total_price: number | null
          type: Database["public"]["Enums"]["movement_type"]
          unit: string
          updated_at: string
          vendor: string | null
          warehouse: string | null
        }
        Insert: {
          actual_payment_date?: string | null
          actual_receive_date?: string | null
          cogs_per_unit?: number | null
          concept: Database["public"]["Enums"]["ip_concept"]
          created_at?: string
          created_by?: string | null
          estimated_payment_date?: string | null
          estimated_receive_date?: string | null
          id?: string
          lot_number?: string | null
          material: string
          movement_date: string
          notes?: string | null
          other_costs?: number | null
          paid?: boolean | null
          price_per_unit?: number | null
          quantity: number
          received?: boolean | null
          shipping_price?: number | null
          total_price?: number | null
          type: Database["public"]["Enums"]["movement_type"]
          unit: string
          updated_at?: string
          vendor?: string | null
          warehouse?: string | null
        }
        Update: {
          actual_payment_date?: string | null
          actual_receive_date?: string | null
          cogs_per_unit?: number | null
          concept?: Database["public"]["Enums"]["ip_concept"]
          created_at?: string
          created_by?: string | null
          estimated_payment_date?: string | null
          estimated_receive_date?: string | null
          id?: string
          lot_number?: string | null
          material?: string
          movement_date?: string
          notes?: string | null
          other_costs?: number | null
          paid?: boolean | null
          price_per_unit?: number | null
          quantity?: number
          received?: boolean | null
          shipping_price?: number | null
          total_price?: number | null
          type?: Database["public"]["Enums"]["movement_type"]
          unit?: string
          updated_at?: string
          vendor?: string | null
          warehouse?: string | null
        }
        Relationships: []
      }
      logistics_accessorial_rates: {
        Row: {
          assumed_lb_per_case: number
          bol_per_shipment: number
          case_picking_per_case: number
          cases_per_pallet: number
          created_at: string
          id: string
          loading_per_pallet: number
          updated_at: string
        }
        Insert: {
          assumed_lb_per_case?: number
          bol_per_shipment?: number
          case_picking_per_case?: number
          cases_per_pallet?: number
          created_at?: string
          id?: string
          loading_per_pallet?: number
          updated_at?: string
        }
        Update: {
          assumed_lb_per_case?: number
          bol_per_shipment?: number
          case_picking_per_case?: number
          cases_per_pallet?: number
          created_at?: string
          id?: string
          loading_per_pallet?: number
          updated_at?: string
        }
        Relationships: []
      }
      logistics_dc_mapping: {
        Row: {
          canonical_dc: string | null
          created_at: string
          excluded: boolean
          id: string
          quien_cobra_flete: string | null
          raw_customer_name: string
          updated_at: string
        }
        Insert: {
          canonical_dc?: string | null
          created_at?: string
          excluded?: boolean
          id?: string
          quien_cobra_flete?: string | null
          raw_customer_name: string
          updated_at?: string
        }
        Update: {
          canonical_dc?: string | null
          created_at?: string
          excluded?: boolean
          id?: string
          quien_cobra_flete?: string | null
          raw_customer_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      logistics_forecast_dc_mix: {
        Row: {
          canonical_dc: string
          created_at: string
          distributor: string
          id: string
          mix_pct: number
          updated_at: string
        }
        Insert: {
          canonical_dc: string
          created_at?: string
          distributor: string
          id?: string
          mix_pct?: number
          updated_at?: string
        }
        Update: {
          canonical_dc?: string
          created_at?: string
          distributor?: string
          id?: string
          mix_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      logistics_forecast_distributor_mix: {
        Row: {
          created_at: string
          distributor: string
          id: string
          mix_pct: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          distributor: string
          id?: string
          mix_pct?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          distributor?: string
          id?: string
          mix_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      logistics_forecast_shipment_profile: {
        Row: {
          avg_cases_per_shipment: number
          avg_cost_per_shipment: number
          canonical_dc: string
          created_at: string
          flete_pct: number
          id: string
          shipment_sample: number
          updated_at: string
        }
        Insert: {
          avg_cases_per_shipment?: number
          avg_cost_per_shipment?: number
          canonical_dc: string
          created_at?: string
          flete_pct?: number
          id?: string
          shipment_sample?: number
          updated_at?: string
        }
        Update: {
          avg_cases_per_shipment?: number
          avg_cost_per_shipment?: number
          canonical_dc?: string
          created_at?: string
          flete_pct?: number
          id?: string
          shipment_sample?: number
          updated_at?: string
        }
        Relationships: []
      }
      logistics_invoice_orders: {
        Row: {
          allocated_amount: number
          created_at: string
          id: string
          invoice_id: string
          order_id: string | null
          po_number: string | null
        }
        Insert: {
          allocated_amount?: number
          created_at?: string
          id?: string
          invoice_id: string
          order_id?: string | null
          po_number?: string | null
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          order_id?: string | null
          po_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logistics_invoice_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "logistics_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logistics_invoice_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_invoices: {
        Row: {
          bol: string | null
          canonical_dc: string | null
          carrier: string
          cases: number | null
          category: string
          charges: Json | null
          created_at: string
          detention: number | null
          freight_base: number | null
          fuel: number | null
          id: string
          invoice_date: string
          invoice_number: string
          is_supplemental: boolean
          lumper: number | null
          pallets: number | null
          pdf_path: string | null
          po_ref: string | null
          status: string
          total_charged: number
          updated_at: string
          weight_lb: number | null
        }
        Insert: {
          bol?: string | null
          canonical_dc?: string | null
          carrier: string
          cases?: number | null
          category: string
          charges?: Json | null
          created_at?: string
          detention?: number | null
          freight_base?: number | null
          fuel?: number | null
          id?: string
          invoice_date: string
          invoice_number: string
          is_supplemental?: boolean
          lumper?: number | null
          pallets?: number | null
          pdf_path?: string | null
          po_ref?: string | null
          status?: string
          total_charged?: number
          updated_at?: string
          weight_lb?: number | null
        }
        Update: {
          bol?: string | null
          canonical_dc?: string | null
          carrier?: string
          cases?: number | null
          category?: string
          charges?: Json | null
          created_at?: string
          detention?: number | null
          freight_base?: number | null
          fuel?: number | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          is_supplemental?: boolean
          lumper?: number | null
          pallets?: number | null
          pdf_path?: string | null
          po_ref?: string | null
          status?: string
          total_charged?: number
          updated_at?: string
          weight_lb?: number | null
        }
        Relationships: []
      }
      logistics_kehe_rate: {
        Row: {
          canonical_dc: string
          cost_per_lb: number
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          canonical_dc: string
          cost_per_lb?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          canonical_dc?: string
          cost_per_lb?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      logistics_lineage_surcharges: {
        Row: {
          created_at: string
          detention_expected: number
          fuel_surcharge_pct: number
          id: string
          lumper_expected: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          detention_expected?: number
          fuel_surcharge_pct?: number
          id?: string
          lumper_expected?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          detention_expected?: number
          fuel_surcharge_pct?: number
          id?: string
          lumper_expected?: number
          updated_at?: string
        }
        Relationships: []
      }
      logistics_lineage_tariff: {
        Row: {
          canonical_dc: string
          confianza: string
          created_at: string
          id: string
          plt_1: number
          plt_10: number
          plt_2: number
          plt_3: number
          plt_4: number
          plt_5: number
          plt_6: number
          plt_7: number
          plt_8: number
          plt_9: number
          state: string | null
          updated_at: string
        }
        Insert: {
          canonical_dc: string
          confianza?: string
          created_at?: string
          id?: string
          plt_1?: number
          plt_10?: number
          plt_2?: number
          plt_3?: number
          plt_4?: number
          plt_5?: number
          plt_6?: number
          plt_7?: number
          plt_8?: number
          plt_9?: number
          state?: string | null
          updated_at?: string
        }
        Update: {
          canonical_dc?: string
          confianza?: string
          created_at?: string
          id?: string
          plt_1?: number
          plt_10?: number
          plt_2?: number
          plt_3?: number
          plt_4?: number
          plt_5?: number
          plt_6?: number
          plt_7?: number
          plt_8?: number
          plt_9?: number
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      logistics_storage_rates: {
        Row: {
          created_at: string
          id: string
          receipt_per_pallet: number
          renewal_per_pallet_month: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          receipt_per_pallet?: number
          renewal_per_pallet_month?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          receipt_per_pallet?: number
          renewal_per_pallet_month?: number
          updated_at?: string
        }
        Relationships: []
      }
      lot_master: {
        Row: {
          cases_initial: number | null
          cogs_per_case: number | null
          cogs_status: string | null
          created_at: string | null
          expiry_date: string | null
          id: string
          lineage_item_code: string | null
          lot_number: string
          notes: string | null
          sku: string
          updated_at: string | null
          warehouse: string | null
        }
        Insert: {
          cases_initial?: number | null
          cogs_per_case?: number | null
          cogs_status?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          lineage_item_code?: string | null
          lot_number: string
          notes?: string | null
          sku: string
          updated_at?: string | null
          warehouse?: string | null
        }
        Update: {
          cases_initial?: number | null
          cogs_per_case?: number | null
          cogs_status?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          lineage_item_code?: string | null
          lot_number?: string
          notes?: string | null
          sku?: string
          updated_at?: string | null
          warehouse?: string | null
        }
        Relationships: []
      }
      ops_bom: {
        Row: {
          material: string
          qty_per_case: number | null
          sku: string
        }
        Insert: {
          material: string
          qty_per_case?: number | null
          sku: string
        }
        Update: {
          material?: string
          qty_per_case?: number | null
          sku?: string
        }
        Relationships: []
      }
      ops_forecast_po: {
        Row: {
          created_at: string | null
          created_by: string | null
          freight: number | null
          id: number
          mat_cost: number | null
          material: string
          month_buy: string | null
          month_pay: string | null
          month_receive: string | null
          qty: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          freight?: number | null
          id?: number
          mat_cost?: number | null
          material: string
          month_buy?: string | null
          month_pay?: string | null
          month_receive?: string | null
          qty?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          freight?: number | null
          id?: number
          mat_cost?: number | null
          material?: string
          month_buy?: string | null
          month_pay?: string | null
          month_receive?: string | null
          qty?: number | null
        }
        Relationships: []
      }
      ops_published: {
        Row: {
          key: string
          published_at: string | null
          published_by: string | null
          value: Json
        }
        Insert: {
          key: string
          published_at?: string | null
          published_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          published_at?: string | null
          published_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      ops_raw_materials: {
        Row: {
          active: boolean | null
          default_price: number | null
          display_name: string | null
          lead_time_weeks: number | null
          material: string
          overfill_pct: number | null
          pack_size: number | null
          payment_terms: string | null
          scrap_pct: number | null
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          active?: boolean | null
          default_price?: number | null
          display_name?: string | null
          lead_time_weeks?: number | null
          material: string
          overfill_pct?: number | null
          pack_size?: number | null
          payment_terms?: string | null
          scrap_pct?: number | null
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          active?: boolean | null
          default_price?: number | null
          display_name?: string | null
          lead_time_weeks?: number | null
          material?: string
          overfill_pct?: number | null
          pack_size?: number | null
          payment_terms?: string | null
          scrap_pct?: number | null
          sort_order?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      ops_wip: {
        Row: {
          cases: number | null
          due_date: string | null
          sku: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          cases?: number | null
          due_date?: string | null
          sku: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          cases?: number | null
          due_date?: string | null
          sku?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      production_runs: {
        Row: {
          cases_produced: number
          cogs_per_case: number
          created_at: string
          created_by: string | null
          facility: Database["public"]["Enums"]["facility"]
          fp_movement_id: string | null
          id: string
          lot_number: string
          notes: string | null
          run_date: string
          sku: Database["public"]["Enums"]["sku"]
          updated_at: string
          warehouse: Database["public"]["Enums"]["warehouse"]
        }
        Insert: {
          cases_produced: number
          cogs_per_case: number
          created_at?: string
          created_by?: string | null
          facility: Database["public"]["Enums"]["facility"]
          fp_movement_id?: string | null
          id?: string
          lot_number: string
          notes?: string | null
          run_date: string
          sku: Database["public"]["Enums"]["sku"]
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse"]
        }
        Update: {
          cases_produced?: number
          cogs_per_case?: number
          created_at?: string
          created_by?: string | null
          facility?: Database["public"]["Enums"]["facility"]
          fp_movement_id?: string | null
          id?: string
          lot_number?: string
          notes?: string | null
          run_date?: string
          sku?: Database["public"]["Enums"]["sku"]
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      runway_cogs_estimado_payments: {
        Row: {
          heinlein_tolling: number
          id: string
          ingredient_purchases: number
          notes: string | null
          payment_month: string
          updated_at: string
        }
        Insert: {
          heinlein_tolling?: number
          id?: string
          ingredient_purchases?: number
          notes?: string | null
          payment_month: string
          updated_at?: string
        }
        Update: {
          heinlein_tolling?: number
          id?: string
          ingredient_purchases?: number
          notes?: string | null
          payment_month?: string
          updated_at?: string
        }
        Relationships: []
      }
      runway_events: {
        Row: {
          amount: number
          created_at: string
          description: string
          event_date: string
          id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          event_date: string
          id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          event_date?: string
          id?: string
        }
        Relationships: []
      }
      runway_fixed_costs: {
        Row: {
          active: boolean
          amount: number
          id: string
          label: string
          sort_order: number
          timing: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount: number
          id?: string
          label: string
          sort_order?: number
          timing: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          id?: string
          label?: string
          sort_order?: number
          timing?: string
          updated_at?: string
        }
        Relationships: []
      }
      runway_settings: {
        Row: {
          date_value: string | null
          key: string
          number_value: number | null
          text_value: string | null
          updated_at: string
        }
        Insert: {
          date_value?: string | null
          key: string
          number_value?: number | null
          text_value?: string | null
          updated_at?: string
        }
        Update: {
          date_value?: string | null
          key?: string
          number_value?: number | null
          text_value?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_write: { Args: never; Returns: boolean }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer"
      distributor: "UNFI" | "KeHe" | "Rainforest" | "RFD" | "Direct" | "Other"
      facility: "Heinlein" | "Empire" | "OOE"
      fp_concept:
        | "Production"
        | "Sale"
        | "Sample"
        | "Damage"
        | "Transfer"
        | "Free"
        | "Historical"
        | "Balance correction"
      ip_concept:
        | "Procurement"
        | "Consumption"
        | "Damage"
        | "Transfer"
        | "Inventory"
        | "Inv Adjustment"
        | "Work in Progress"
        | "Pistachio Production"
        | "Hazelnut And Milk Production"
      movement_type: "In" | "Out"
      order_status:
        | "Open"
        | "Acknowledged"
        | "Shipment"
        | "Invoiced"
        | "Accepted"
        | "Sent to 3PL"
        | "BOL Confirmed"
      sku: "XD" | "PW" | "HM" | "WM" | "WD" | "Matcha"
      warehouse:
        | "Lineage Newark"
        | "Cold Chain"
        | "Empire"
        | "Heinlein"
        | "OOE"
        | "FreezPak"
        | "PermaFrost"
        | "Pod Chicago"
        | "Pod MidAtlantic"
        | "Pod Texas"
        | "Lineage Linden"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
      distributor: ["UNFI", "KeHe", "Rainforest", "RFD", "Direct", "Other"],
      facility: ["Heinlein", "Empire", "OOE"],
      fp_concept: [
        "Production",
        "Sale",
        "Sample",
        "Damage",
        "Transfer",
        "Free",
        "Historical",
        "Balance correction",
      ],
      ip_concept: [
        "Procurement",
        "Consumption",
        "Damage",
        "Transfer",
        "Inventory",
        "Inv Adjustment",
        "Work in Progress",
        "Pistachio Production",
        "Hazelnut And Milk Production",
      ],
      movement_type: ["In", "Out"],
      order_status: [
        "Open",
        "Acknowledged",
        "Shipment",
        "Invoiced",
        "Accepted",
        "Sent to 3PL",
        "BOL Confirmed",
      ],
      sku: ["XD", "PW", "HM", "WM", "WD", "Matcha"],
      warehouse: [
        "Lineage Newark",
        "Cold Chain",
        "Empire",
        "Heinlein",
        "OOE",
        "FreezPak",
        "PermaFrost",
        "Pod Chicago",
        "Pod MidAtlantic",
        "Pod Texas",
        "Lineage Linden",
      ],
    },
  },
} as const
