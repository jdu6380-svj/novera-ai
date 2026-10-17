"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { LoginPage } from "@/components/auth/login-page";
import { Phase5ConnectedWorkspace } from "@/components/phase5/phase5-connected-workspace";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";

export function AuthenticatedWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  function displayName(nextUser: User): string | undefined {
    const metadata = nextUser.user_metadata;
    const value = metadata?.display_name ?? metadata?.full_name;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setChecking(false);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  if (checking) return <div className="auth-loading" role="status">正在检查登录状态…</div>;
  if (!session || !user) return <LoginPage />;
  return <Phase5ConnectedWorkspace userEmail={user.email ?? ""} userName={displayName(user)} onSignOut={() => void getSupabaseBrowserClient().auth.signOut()} />;
}
