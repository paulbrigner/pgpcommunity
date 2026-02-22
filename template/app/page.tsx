import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/signin");
  }

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Google Auth Canary</p>
        <h1>Hello world</h1>
        <p>
          You are signed in as <strong>{session.user.email}</strong>.
        </p>
        <p>The template currently allows only users from your configured company domain.</p>
        <div className="button-row">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
