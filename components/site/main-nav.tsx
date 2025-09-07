"use client";

import { useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { signInWithSiwe } from "@/lib/siwe/client";

export function MainNav() {
  const { status } = useSession();
  const authenticated = status === "authenticated";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const callbackUrl = useMemo(() => {
    const q = searchParams?.toString();
    return q && q.length ? `${pathname}?${q}` : pathname || "/";
  }, [pathname, searchParams]);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold">PGP* Community</Link>
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                <Link href="/">Home</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {authenticated && (
              <NavigationMenuItem>
                <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                  <Link href="/settings/profile">Edit Profile</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            )}

            {!authenticated && (
              <NavigationMenuItem>
                <NavigationMenuLink className={navigationMenuTriggerStyle()} asChild>
                  <Link href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&reason=signup`}>Sign Up</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            )}

            {!authenticated && (
              <NavigationMenuItem>
                <a
                  href="#signin"
                  className={navigationMenuTriggerStyle()}
                  onClick={async (e) => {
                    e.preventDefault();
                    const res = await signInWithSiwe();
                    if (!res.ok) {
                      router.push(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&reason=wallet-unlinked`);
                    }
                  }}
                >
                  Sign In
                </a>
              </NavigationMenuItem>
            )}

            {authenticated && (
              <NavigationMenuItem>
                <a
                  href="#logout"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await signOut({ callbackUrl: "/" });
                    } catch {
                      router.push("/");
                    }
                  }}
                  className={navigationMenuTriggerStyle()}
                >
                  Log Out
                </a>
              </NavigationMenuItem>
            )}
          </NavigationMenuList>
        </NavigationMenu>
      </div>
    </header>
  );
}
