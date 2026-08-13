import { useEffect, useState } from "react";
import { client } from "../lib/supabase";

/**
 * "This account belongs to your company, and your company can see it."
 *
 * Said plainly, in Settings, to the person whose account it is. An enterprise
 * administrator can read the work on the accounts their company provisions —
 * the ordinary arrangement for a company-issued tool — and the difference
 * between that being reasonable and that being a scandal is entirely whether
 * the person was told.
 *
 * It is also the honest thing for the company: a disclosure most jurisdictions
 * expect, made once, in the place somebody looks for it, rather than buried in
 * terms nobody reads.
 *
 * Renders nothing for a personal account, which is almost everybody.
 */
export default function Managed() {
  const [org, setOrg] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const supabase = await client();
        if (!supabase) return;
        const { data: session } = await supabase.auth.getSession();
        if (!session?.session) return;

        // The roster row carries the company's name; RLS already limits this
        // to companies this account actually belongs to.
        const { data } = await supabase
          .from("org_members")
          .select("role, organizations(name)")
          .limit(1)
          .maybeSingle();
        if (!live || !data) return;
        setOrg({ name: data.organizations?.name || "your company", admin: data.role === "admin" });
      } catch {
        // No backend, signed out, or no company: nothing to disclose.
      }
    })();
    return () => { live = false; };
  }, []);

  if (!org) return null;

  return (
    <div className="text-[15px] leading-relaxed">
      <p>
        This account is part of <span className="font-medium">{org.name}</span>.
      </p>
      <p className="mt-1 text-[var(--muted)]">
        {org.admin
          ? "As an administrator you can see the projects, tasks and calendars on the accounts your company provides — and not edit them. Your own work is yours."
          : "Administrators at your company can see the projects, tasks and calendar on this account, the same way they can see anything on a company device. They cannot change them, and they cannot read your conversations with Squirrel."}
      </p>
      <p className="mt-1 text-[var(--faint)]">
        Anything you keep in a personal account, on your own subscription, stays private to you.
      </p>
    </div>
  );
}
