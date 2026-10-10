import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { UserProfile } from "../types";

/**
 * ChemPoint Production Client-Side Supabase Integration
 * Uses official @supabase/supabase-js directly in the browser.
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY exposed by Vite.
 */
const DEFAULT_SUPABASE_URL = "https://lrhsiwxcvdwhfzcecjek.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyaHNpd3hjdmR3aGZ6Y2VjamVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTk2MTQsImV4cCI6MjEwNDI3NTYxNH0.wg9v1-u8GdorfTKkjiheEDIfa5YopT0DNIjkcDF7jRk";

const envUrl = (import.meta.env?.VITE_SUPABASE_URL as string) || "";
const envAnonKey = (import.meta.env?.VITE_SUPABASE_ANON_KEY as string) || "";

export const SUPABASE_URL = (envUrl.trim() || DEFAULT_SUPABASE_URL)
  .replace(/\/rest\/v1\/?$/, "")
  .replace(/\/$/, "");

export const SUPABASE_ANON_KEY = envAnonKey.trim() || DEFAULT_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "chempoint_sb_auth_token",
  },
});

/**
 * Helper to determine if an email belongs to admin / faculty
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return (
    clean === "faculty@chempoint.edu" ||
    clean === "tapas489@gmail.com" ||
    clean === "tapash489@gmail.com" ||
    clean === "admin@chempoint.edu" ||
    clean === "admin@apexacademy.edu"
  );
}

/**
 * Build a reliable fallback profile from Supabase Auth User object
 * Enforces security: Only recognized faculty emails get the admin role.
 */
export function buildProfileFromAuthUser(authUser: User): UserProfile {
  const metadata = authUser.user_metadata || {};
  const email = authUser.email || "";
  const isAdmin = isAdminEmail(email);
  const fullName =
    metadata.full_name ||
    (isAdmin ? "Tapas Majumder" : email.split("@")[0] || "ChemPoint Student");

  return {
    id: authUser.id,
    email: email.toLowerCase(),
    role: isAdmin ? "admin" : "student",
    full_name: fullName,
    phone: metadata.phone || "",
    avatar_url:
      metadata.avatar_url ||
      `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName)}&backgroundColor=6d28d9`,
    batch_name: metadata.batch_name || (isAdmin ? "Academic Faculty & Administration" : "Class 11 Chemistry Batch"),
    target_exam: metadata.target_exam || (isAdmin ? "Academic Council" : "Class 11 Chemistry"),
    roll_number: metadata.roll_number || (isAdmin ? "CP-FAC-01" : "CP-2026-001"),
    created_at: authUser.created_at || new Date().toISOString(),
  };
}

/**
 * Fetch profile directly from public.profiles via Supabase RLS.
 * If database row query errors or delays, safely synthesizes profile from
 * authUser to maintain user session without causing an unwanted logout.
 */
export async function fetchProfileById(
  userId: string,
  authUserFallback?: User | null
): Promise<UserProfile | null> {
  console.log("[AUTH DEBUG] profile lookup started for id:", userId);
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.warn("[AUTH DEBUG] Profile table query warning:", error.message);
    }

    if (data) {
      if (!data.avatar_url || !data.avatar_url.trim()) {
        data.avatar_url = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
          data.full_name || data.email || "User"
        )}&backgroundColor=6d28d9`;
      }
      console.log("[AUTH DEBUG] profile found: true - role:", data.role, "- name:", data.full_name);
      return data as UserProfile;
    }

    // If no row in profiles, check fallback user metadata
    if (authUserFallback) {
      console.log("[AUTH DEBUG] profile not found in table, synthesizing from authUser fallback");
      return buildProfileFromAuthUser(authUserFallback);
    }

    console.log("[AUTH DEBUG] profile found: false");
    return null;
  } catch (e: any) {
    console.error("[AUTH DEBUG] Profile query exception:", e?.message || e);
    if (authUserFallback) {
      return buildProfileFromAuthUser(authUserFallback);
    }
    return null;
  }
}
