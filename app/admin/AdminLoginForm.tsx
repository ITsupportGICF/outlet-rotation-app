"use client";

import { useActionState } from "react";

import { adminLoginAction, type AdminLoginState } from "@/lib/actions/admin";

const initialState: AdminLoginState = { error: null };

export default function AdminLoginForm() {
  const [state, formAction, pending] = useActionState(
    adminLoginAction,
    initialState,
  );

  return (
    <form action={formAction} className="mx-auto max-w-sm space-y-5">
      <div>
        <label htmlFor="username" className="field-label">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoComplete="off"
          className="field-input"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="field-input"
        />
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "#fdecec", border: "1px solid #f3b9b9", color: "#9c2c2c" }}
        >
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary btn-lg btn-block"
      >
        {pending ? "Checking…" : "Unlock Admin Center"}
      </button>
    </form>
  );
}
