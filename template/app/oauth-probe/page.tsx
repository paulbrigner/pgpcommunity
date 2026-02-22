type ProbePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || null;
  return null;
}

function explainError(error: string | null, subtype: string | null): string {
  if (subtype === "admin_policy_enforced") {
    return "Workspace policy blocked this app. Admin review is required to allow access.";
  }
  if (error === "access_denied") {
    return "Google denied access. This can be org policy, app audience settings, or user cancellation.";
  }
  if (error === "org_internal") {
    return "The OAuth app audience is internal to another organization.";
  }
  if (error) {
    return "Google returned an OAuth error. Use the values below to diagnose the exact cause.";
  }
  return "No OAuth errors were returned.";
}

export default async function OauthProbePage({ searchParams }: ProbePageProps) {
  const params = (await searchParams) || {};
  const setupError = asString(params.setup_error);
  const code = asString(params.code);
  const error = asString(params.error);
  const errorSubtype = asString(params.error_subtype);
  const errorDescription = asString(params.error_description);

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Google Policy Probe</p>
        <h1>OAuth probe</h1>
        <p>This test helps detect Workspace restrictions without requiring admin privileges.</p>

        {setupError ? <p className="error-text">Setup error: {setupError}</p> : null}

        {code ? (
          <p className="success-text">
            Probe successful: Google returned an authorization code, so the account was not blocked at the authorization
            step.
          </p>
        ) : null}

        {!code ? <p>{explainError(error, errorSubtype)}</p> : null}

        <dl className="probe-list">
          <div>
            <dt>error</dt>
            <dd>{error || "-"}</dd>
          </div>
          <div>
            <dt>error_subtype</dt>
            <dd>{errorSubtype || "-"}</dd>
          </div>
          <div>
            <dt>error_description</dt>
            <dd>{errorDescription || "-"}</dd>
          </div>
        </dl>

        <div className="button-row">
          <a className="button" href="/api/oauth/probe/start">
            Start probe
          </a>
          <a className="button button-secondary" href="/signin">
            Back to sign in
          </a>
        </div>
      </section>
    </main>
  );
}
