"use client";

import { useActionState } from "react";

import {
  completeAccountSetupAction,
  type SetupState,
} from "@/lib/actions/admin-users";

const initialState: SetupState = { error: null };

export default function AccountSetupForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    completeAccountSetupAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />

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
          Password (at least 10 characters)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          className="field-input"
        />
      </div>

      <div>
        <label htmlFor="confirm" className="field-label">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
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
        {pending ? "Setting up…" : "Create my account"}
      </button>
    </form>
  );
}
