import SignInClient from "./signin-client";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0] || null;
  return null;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = (await searchParams) || {};
  const error = asString(params.error);

  return <SignInClient error={error} />;
}
