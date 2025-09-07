"use client";

import { useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";

export function MainNav() {
  const { status } = useSession();
  const authenticated = status === "authenticated";
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
              <Link href="/" legacyBehavior passHref>
                <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                  Home
                </NavigationMenuLink>
              </Link>
            </NavigationMenuItem>

            {authenticated && (
              <NavigationMenuItem>
                <Link href="/settings/profile" legacyBehavior passHref>
                  <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                    Edit Profile
                  </NavigationMenuLink>
                </Link>
              </NavigationMenuItem>
            )}

            {!authenticated && (
              <NavigationMenuItem>
                <Link href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&reason=signup`} legacyBehavior passHref>
                  <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                    Sign Up
                  </NavigationMenuLink>
                </Link>
              </NavigationMenuItem>
            )}

            {!authenticated && (
              <NavigationMenuItem>
                <Link href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`} legacyBehavior passHref>
                  <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                    Sign In
                  </NavigationMenuLink>
                </Link>
              </NavigationMenuItem>
            )}

            {authenticated && (
              <NavigationMenuItem>
                <a
                  href="#logout"
                  onClick={(e) => { e.preventDefault(); signOut(); }}
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
