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
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      backlink_edges: {
        Row: {
          context: string | null
          created_at: string | null
          id: string
          link_text: string | null
          source_id: string
          target_id: string
        }
        Insert: {
          context?: string | null
          created_at?: string | null
          id?: string
          link_text?: string | null
          source_id: string
          target_id: string
        }
        Update: {
          context?: string | null
          created_at?: string | null
          id?: string
          link_text?: string | null
          source_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlink_edges_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlink_edges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      containment_edges: {
        Row: {
          child_id: string
          created_at: string | null
          id: string
          parent_id: string
          position: number
        }
        Insert: {
          child_id: string
          created_at?: string | null
          id?: string
          parent_id: string
          position: number
        }
        Update: {
          child_id?: string
          created_at?: string | null
          id?: string
          parent_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "containment_edges_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containment_edges_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_similarities: {
        Row: {
          keyword_a_id: string
          keyword_b_id: string
          similarity: number
        }
        Insert: {
          keyword_a_id: string
          keyword_b_id: string
          similarity: number
        }
        Update: {
          keyword_a_id?: string
          keyword_b_id?: string
          similarity?: number
        }
        Relationships: [
          {
            foreignKeyName: "keyword_similarities_keyword_a_id_fkey"
            columns: ["keyword_a_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keyword_similarities_keyword_b_id_fkey"
            columns: ["keyword_b_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      keywords: {
        Row: {
          community_id: number | null
          created_at: string | null
          embedding: string | null
          embedding_256: string | null
          id: string
          is_community_hub: boolean | null
          keyword: string
          node_id: string
          node_type: string | null
        }
        Insert: {
          community_id?: number | null
          created_at?: string | null
          embedding?: string | null
          embedding_256?: string | null
          id?: string
          is_community_hub?: boolean | null
          keyword: string
          node_id: string
          node_type?: string | null
        }
        Update: {
          community_id?: number | null
          created_at?: string | null
          embedding?: string | null
          embedding_256?: string | null
          id?: string
          is_community_hub?: boolean | null
          keyword?: string
          node_id?: string
          node_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keywords_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          chunk_type: string | null
          content: string | null
          content_hash: string
          created_at: string | null
          dirty: boolean | null
          embedding: string | null
          header_level: number | null
          heading_context: string[] | null
          id: string
          node_type: string
          source_path: string
          summary: string | null
          updated_at: string | null
        }
        Insert: {
          chunk_type?: string | null
          content?: string | null
          content_hash: string
          created_at?: string | null
          dirty?: boolean | null
          embedding?: string | null
          header_level?: number | null
          heading_context?: string[] | null
          id?: string
          node_type: string
          source_path: string
          summary?: string | null
          updated_at?: string | null
        }
        Update: {
          chunk_type?: string | null
          content?: string | null
          content_hash?: string
          created_at?: string | null
          dirty?: boolean | null
          embedding?: string | null
          header_level?: number | null
          heading_context?: string[] | null
          id?: string
          node_type?: string
          source_path?: string
          summary?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      summary_cache: {
        Row: {
          content_hash: string
          created_at: string | null
          id: string
          lens: string | null
          node_id: string
          summary: string
          zoom_level: number
        }
        Insert: {
          content_hash: string
          created_at?: string | null
          id?: string
          lens?: string | null
          node_id: string
          summary: string
          zoom_level: number
        }
        Update: {
          content_hash?: string
          created_at?: string | null
          id?: string
          lens?: string | null
          node_id?: string
          summary?: string
          zoom_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "summary_cache_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_similar_keywords_for_node: {
        Args: {
          match_count?: number
          min_similarity?: number
          node_embedding: string
        }
        Returns: {
          keyword: string
          similarity: number
        }[]
      }
      get_article_keyword_graph:
        | {
            Args: { max_edges_per_article?: number; min_similarity?: number }
            Returns: {
              article_id: string
              article_path: string
              article_size: number
              keyword_id: string
              keyword_text: string
              similar_article_id: string
              similar_article_path: string
              similar_article_size: number
              similar_keyword_id: string
              similar_keyword_text: string
              similarity: number
            }[]
          }
        | {
            Args: { similarity_threshold?: number }
            Returns: {
              article_id: string
              article_path: string
              article_size: number
              keyword_id: string
              keyword_text: string
              similar_article_id: string
              similar_article_path: string
              similar_article_size: number
              similar_keyword_id: string
              similar_keyword_text: string
              similarity: number
            }[]
          }
      get_filtered_map: {
        Args: {
          keyword_similarity_threshold?: number
          match_threshold?: number
          query_embedding_256: string
        }
        Returns: {
          article_id: string
          article_path: string
          article_size: number
          keyword_id: string
          keyword_text: string
          similar_article_id: string
          similar_article_path: string
          similar_article_size: number
          similar_keyword_id: string
          similar_keyword_text: string
          similarity: number
        }[]
      }
      get_similar_keyword_pairs: {
        Args: { similarity_threshold?: number }
        Returns: {
          article1_id: string
          article2_id: string
          keyword1_id: string
          keyword1_text: string
          keyword2_id: string
          keyword2_text: string
          similarity: number
        }[]
      }
      search_similar: {
        Args: {
          filter_node_type?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          matched_keywords: Json
          node_type: string
          similarity: number
          source_path: string
          summary: string
        }[]
      }
      search_similar_keywords: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          id: string
          keyword: string
          node_id: string
          similarity: number
        }[]
      }
      test_keyword_search: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          keyword: string
          keyword_id: string
          node_id: string
          similarity: number
        }[]
      }
      test_node_search: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          id: string
          similarity: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
