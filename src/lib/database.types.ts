export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      matchups: {
        Row: {
          created_at: string;
          id: number;
          loser_name: string;
          skipped: boolean;
          winner_name: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          loser_name: string;
          skipped?: boolean;
          winner_name: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          loser_name?: string;
          skipped?: boolean;
          winner_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "matchups_loser_name_fkey";
            columns: ["loser_name"];
            isOneToOne: false;
            referencedRelation: "pokemon";
            referencedColumns: ["name"];
          },
          {
            foreignKeyName: "matchups_winner_name_fkey";
            columns: ["winner_name"];
            isOneToOne: false;
            referencedRelation: "pokemon";
            referencedColumns: ["name"];
          },
        ];
      };
      pokemon: {
        Row: {
          bst: number;
          display_name: string;
          form_display_name: string;
          form_name: string;
          id: number;
          name: string;
          sprite_url: string;
          type1: string;
          type2: string | null;
        };
        Insert: {
          bst: number;
          display_name: string;
          form_display_name: string;
          form_name: string;
          id: number;
          name: string;
          sprite_url: string;
          type1: string;
          type2?: string | null;
        };
        Update: {
          bst?: number;
          display_name?: string;
          form_display_name?: string;
          form_name?: string;
          id?: number;
          name?: string;
          sprite_url?: string;
          type1?: string;
          type2?: string | null;
        };
        Relationships: [];
      };
      ratings: {
        Row: {
          match_count: number;
          mu: number;
          ordinal: number;
          pokemon_name: string;
          sigma: number;
        };
        Insert: {
          match_count?: number;
          mu: number;
          ordinal: number;
          pokemon_name: string;
          sigma: number;
        };
        Update: {
          match_count?: number;
          mu?: number;
          ordinal?: number;
          pokemon_name?: string;
          sigma?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ratings_pokemon_name_fkey";
            columns: ["pokemon_name"];
            isOneToOne: true;
            referencedRelation: "pokemon";
            referencedColumns: ["name"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      record_skip: {
        Args: { p_pokemon_a_name: string; p_pokemon_b_name: string };
        Returns: undefined;
      };
      record_vote: {
        Args: {
          p_loser_match_count: number;
          p_loser_mu: number;
          p_loser_name: string;
          p_loser_ordinal: number;
          p_loser_sigma: number;
          p_winner_match_count: number;
          p_winner_mu: number;
          p_winner_name: string;
          p_winner_ordinal: number;
          p_winner_sigma: number;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
