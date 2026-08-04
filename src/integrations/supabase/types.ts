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
    PostgrestVersion: "14.5"
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
          sku?: Database["public"]["Enums"]["sku"]
          type?: Database["public"]["Enums"]["movement_type"]
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse"]
        }
        Relationships: []
      }
      ip_movements: {
        Row: {
          concept: Database["public"]["Enums"]["ip_concept"]
          created_at: string
          created_by: string | null
          id: string
          lot_number: string | null
          material: string
          movement_date: string
          notes: string | null
          quantity: number
          type: Database["public"]["Enums"]["movement_type"]
          unit: string
          updated_at: string
          vendor: string | null
        }
        Insert: {
          concept: Database["public"]["Enums"]["ip_concept"]
          created_at?: string
          created_by?: string | null
          id?: string
          lot_number?: string | null
          material: string
          movement_date: string
          notes?: string | null
          quantity: number
          type: Database["public"]["Enums"]["movement_type"]
          unit: string
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          concept?: Database["public"]["Enums"]["ip_concept"]
          created_at?: string
          created_by?: string | null
          id?: string
          lot_number?: string | null
          material?: string
          movement_date?: string
          notes?: string | null
          quantity?: number
          type?: Database["public"]["Enums"]["movement_type"]
          unit?: string
          updated_at?: string
          vendor?: string | null
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
      ip_concept: "Procurement" | "Consumption" | "Damage" | "Transfer"
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
      warehouse: "Lineage Newark" | "Cold Chain" | "Empire" | "Heinlein" | "OOE"
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
      ],
      ip_concept: ["Procurement", "Consumption", "Damage", "Transfer"],
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
      warehouse: ["Lineage Newark", "Cold Chain", "Empire", "Heinlein", "OOE"],
    },
  },
} as const
