"use client";

import { FormEvent, useEffect, useState } from "react";

import { Phase5Icon } from "@/components/phase5/icons";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/browser-client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getSupabaseBrowserClient().auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(Boolean(data.session));
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (password.length < 8) {
      setError("新密码至少需要 8 位。");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage("密码已更新，正在进入你的知识空间…");
      window.setTimeout(() => window.location.assign("/"), 900);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密码更新失败，请重新打开邮件链接。 ");
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
          <div className="auth-kicker">安全访问</div>
          <h1>让知识回到<br />你手中。</h1>
          <p>设置一个新的登录密码，继续管理你的私有文档与可信回答。</p>
          <ul className="auth-benefits">
            <li><span aria-hidden="true">✓</span><span>密码仅由你本人设置</span></li>
            <li><span aria-hidden="true">✓</span><span>重置链接只使用一次</span></li>
            <li><span aria-hidden="true">✓</span><span>更新后立即保护你的知识空间</span></li>
          </ul>
        </div>
        <p className="auth-story-footer">Novera AI · Private by design</p>
      </section>
      <section className="auth-panel" aria-labelledby="reset-title">
        <div className="auth-panel-inner">
          <div className="auth-panel-kicker">设置新密码</div>
          <h2 id="reset-title">重新进入你的知识空间</h2>
          <p className="auth-intro">{checking ? "正在验证重置链接…" : hasSession ? "请设置一个至少 8 位的新密码。" : "这个重置链接已失效，请返回登录页重新获取。"}</p>
          {checking ? <p className="auth-feedback" role="status">正在验证你的身份…</p> : hasSession ? <form className="auth-reset-form" onSubmit={submit}>
            <label htmlFor="reset-password">新密码</label>
            <div className="auth-reset-password-field">
              <input id="reset-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" />
              <button className="auth-reset-password-toggle" type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((visible) => !visible)}><Phase5Icon name={showPassword ? "eye" : "eye-off"} /></button>
            </div>
            {error ? <p className="auth-feedback auth-feedback-error" role="alert">{error}</p> : null}
            {message ? <p className="auth-feedback auth-feedback-success" role="status">{message}</p> : null}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "正在更新…" : "更新密码"}</button>
          </form> : <p className="auth-feedback auth-feedback-error" role="alert">请从登录页点击“忘记密码？”获取新的重置邮件。</p>}
          <div className="auth-switch"><span>记起密码了？</span><button type="button" onClick={() => window.location.assign("/")}>返回登录</button></div>
          <div className="auth-trust"><span>✓</span><span>每个账号独立知识库</span><span>·</span><span>私有文档管理</span></div>
        </div>
      </section>
    </main>
  );
}
