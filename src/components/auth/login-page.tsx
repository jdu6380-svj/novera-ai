"use client";

import { FormEvent, useEffect, useState } from "react";

import { Phase5Icon } from "@/components/phase5/icons";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";

function authRedirectMessage(code: string | null, description: string | null): string | null {
  if (!code && !description) return null;
  if (code === "otp_expired" || description?.toLowerCase().includes("expired")) {
    return "邮箱确认链接已失效或已使用，请返回注册页重新获取最新邮件。";
  }
  if (code === "access_denied" || code === "confirmation_failed") {
    return "邮箱确认没有完成，请使用最新的确认邮件链接。";
  }
  if (code === "configuration_missing") {
    return "登录服务尚未配置，请联系管理员。";
  }
  return "邮箱确认链接无效，请返回注册页重新获取最新邮件。";
}

function readAuthRedirectError(): string | null {
  if (typeof window === "undefined") return null;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get("error_code") ?? query.get("auth_error") ?? hash.get("error");
  const description = hash.get("error_description");
  return authRedirectMessage(code, description);
}

function clearAuthRedirectError(): void {
  if (typeof window === "undefined") return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = "";
  cleanUrl.searchParams.delete("auth_error");
  window.history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}`);
}

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(() => readAuthRedirectError());
  const [error, setError] = useState<string | null>(redirectError);

  useEffect(() => {
    if (redirectError) clearAuthRedirectError();
  }, [redirectError]);

  useEffect(() => {
    function handleHashChange() {
      const nextError = readAuthRedirectError();
      if (!nextError) return;

      setRedirectError(nextError);
      setMode("login");
      setName("");
      setPassword("");
      setVerificationCode("");
      setVerificationSent(false);
      setResendCooldown(0);
      setMessage(null);
      setError(nextError);
      clearAuthRedirectError();
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function sendVerificationCode() {
    const normalizedEmail = email.trim();
    setError(null);
    setMessage(null);
    if (!normalizedEmail) {
      setError("请先输入邮箱。");
      return;
    }
    if (resendCooldown > 0) return;

    setBusy(true);
    try {
      const { error: recoveryError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: new URL("/auth/reset", window.location.origin).toString(),
      });
      if (recoveryError) throw recoveryError;
      setVerificationSent(true);
      setResendCooldown(60);
      setMessage("6 位数字验证码已发送，请检查收件箱和垃圾邮件。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "验证码发送失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const displayName = name.trim();
      if (mode === "signup" && !displayName) {
        setError("请输入你的名字。");
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (mode === "forgot") {
        if (!/^\d{6}$/.test(verificationCode.trim())) {
          setError("请输入邮件中的 6 位数字验证码。");
          return;
        }

        if (password.length < 8) {
          setError("新密码至少需要 8 位。");
          return;
        }

        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: verificationCode.trim(),
          type: "recovery",
        });
        if (verifyError) throw verifyError;

        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage("密码已更新，正在进入你的知识空间…");
        window.setTimeout(() => window.location.assign("/"), 900);
        return;
      }

      if (mode === "signup" && verificationCode.trim()) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: verificationCode.trim(),
          type: "signup",
        });
        if (verifyError) throw verifyError;
        setMessage("邮箱已验证，正在进入你的知识空间…");
        window.setTimeout(() => window.location.assign("/"), 900);
        return;
      }

      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: { display_name: displayName },
              emailRedirectTo: new URL("/auth/callback", window.location.origin).toString(),
            },
          });
      if (result.error) throw result.error;
      if (mode === "signup") {
        setVerificationSent(!result.data.session);
        setMessage(result.data.session
          ? "账号已创建，正在进入你的知识空间…"
          : "账号已创建。验证码已发送到你的邮箱，请填写验证码完成确认。");
      } else {
        setMessage("登录成功，正在进入你的知识空间…");
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "登录失败，请稍后重试。";
      setError(detail.includes("Invalid login") ? "邮箱或密码不正确。" : detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Novera AI 产品介绍">
        <div className="auth-story-top">
          <div className="auth-brand"><span>N</span><div><strong>Novera AI</strong><small>企业知识智能系统</small></div></div>
          <span className="auth-story-label">NOVERA AI · PRIVATE KNOWLEDGE</span>
        </div>
        <div className="auth-story-copy">
          <div className="auth-kicker">可信知识工作流</div>
          <h1>从企业知识中，获得可信答案。</h1>
          <p>把团队文档沉淀成可检索、可追溯的知识空间，让每个回答都回到原文证据。</p>
          <ul className="auth-benefits">
            <li><span aria-hidden="true">✓</span><span>每个账号拥有独立的私有知识空间</span></li>
            <li><span aria-hidden="true">✓</span><span>回答关联来源，结论可以回到文档核对</span></li>
            <li><span aria-hidden="true">✓</span><span>文档仅你可查看、预览和删除</span></li>
          </ul>
        </div>
        <p className="auth-story-footer">Novera AI · Private by design</p>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel-inner">
          <div className="auth-panel-kicker">{mode === "login" ? "欢迎回来" : mode === "forgot" ? "找回访问权限" : "建立 Novera AI"}</div>
          <h2 id="auth-title">{mode === "login" ? "进入你的知识空间" : mode === "forgot" ? "重置你的密码" : "先从你的名字开始"}</h2>
          <p className="auth-intro">{mode === "login" ? "登录后继续管理你的文档与可信回答。" : mode === "forgot" ? "输入邮箱获取验证码，并设置一个新的登录密码。" : "创建账号后，你的私有知识空间会自动准备好。"}</p>
          <form className="auth-form" onSubmit={submit}>
            {mode === "signup" ? <>
              <label htmlFor="auth-name">你的名字</label>
              <input id="auth-name" type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Alex" />
            </> : null}
            <label htmlFor="auth-email">邮箱</label>
            <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
            {mode === "forgot" ? <button className="auth-send-code" type="button" onClick={() => void sendVerificationCode()} disabled={busy || resendCooldown > 0}>{busy ? "正在发送…" : resendCooldown > 0 ? `${resendCooldown} 秒后重新发送` : verificationSent ? "重新发送验证码" : "发送验证码"}</button> : null}
            {mode !== "forgot" ? <>
              <div className="auth-field-heading"><label htmlFor="auth-password">密码</label>{mode === "signup" ? <span>至少 8 位</span> : null}</div>
              <div className="auth-password-field">
                <input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : 6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "设置登录密码" : "输入密码"} />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  title={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <Phase5Icon name={showPassword ? "eye" : "eye-off"} />
                </button>
              </div>
            </> : null}
            {mode === "signup" && verificationSent ? <>
              <label htmlFor="auth-verification-code">邮箱验证码</label>
              <input id="auth-verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} placeholder="输入邮件中的 6 位数字" />
            </> : null}
            {mode === "forgot" ? <>
              <label htmlFor="auth-verification-code">邮箱验证码</label>
              <input id="auth-verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} placeholder="输入邮件中的 6 位数字" />
              <div className="auth-field-heading"><label htmlFor="auth-password">新密码</label><span>至少 8 位</span></div>
              <div className="auth-password-field">
                <input id="auth-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="设置新密码" />
                <button className="auth-password-toggle" type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} title={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((visible) => !visible)}><Phase5Icon name={showPassword ? "eye" : "eye-off"} /></button>
              </div>
            </> : null}
            {error ? <p className="auth-feedback auth-feedback-error" role="alert">{error}</p> : null}
            {message ? <p className="auth-feedback auth-feedback-success" role="status">{message}</p> : null}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "正在处理…" : mode === "login" ? "登录我的知识空间" : mode === "forgot" ? "更新密码" : verificationSent ? "确认验证码并进入" : "创建账号"}</button>
          </form>
          {mode === "login" ? <button className="auth-forgot" type="button" onClick={() => { setMode("forgot"); setShowPassword(false); setError(null); setMessage(null); }}>忘记密码？</button> : null}
          <div className="auth-switch">{mode === "login" ? "还没有账号？" : mode === "forgot" ? "想起密码了？" : "已经有账号？"}<button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setShowPassword(false); setError(null); setMessage(null); setVerificationCode(""); setVerificationSent(false); setResendCooldown(0); }}>{mode === "login" ? "创建账号" : "返回登录"}</button></div>
          <div className="auth-trust"><span>✓</span><span>每个账号独立知识库</span><span>·</span><span>私有文档管理</span></div>
        </div>
      </section>
    </main>
  );
}
