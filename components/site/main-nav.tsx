"use client";

import { useMemo, useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Loader2, Menu, X } from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { signInWithSiwe } from "@/lib/siwe/client";
import { cn } from "@/lib/utils";

export function MainNav() {
  const { data: session, status } = useSession();
  const authenticated = status === "authenticated";
  const isAdmin = !!(session?.user as any)?.isAdmin;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const callbackUrl = useMemo(() => {
    const q = searchParams?.toString();
    return q && q.length ? `${pathname}?${q}` : pathname || "/";
  }, [pathname, searchParams]);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [navLoading, setNavLoading] = useState(false);

  const linkClasses = cn(
    navigationMenuTriggerStyle(),
    "rounded-full border border-white/10 bg-transparent px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[var(--brand-cloud)] transition hover:border-white/20 hover:bg-white/10 hover:text-white"
  );
  const externalLinkClasses = cn(
    navigationMenuTriggerStyle(),
    "rounded-full border border-amber-300/60 bg-white/5 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-amber-100 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] transition hover:border-amber-200 hover:bg-amber-50/10 hover:text-white"
  );

  const handleSignIn = async () => {
    const res = await signInWithSiwe();
    if (!res.ok) {
      router.push(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&reason=wallet-unlinked`);
    }
  };

  useEffect(() => {
    setMobileOpen(false);
    setNavLoading(false);
  }, [pathname, status]);

  const closeMobileMenu = () => setMobileOpen(false);
  const mobileMenuId = "main-nav-mobile-menu";
  const mobileToggleClasses =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:border-white/35 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";
  const mobileMenuItemClasses =
    "block w-full rounded-full border border-white/25 px-5 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/90 transition hover:border-white/45 hover:bg-white/10";

  const mobileMenuItems = authenticated
    ? [
        { key: "home", label: "Home", href: "/" },
        {
          key: "profile",
          label: "Edit Profile",
          href: "/settings/profile",
        },
        ...(isAdmin
          ? [{
              key: "admin",
              label: "Admin",
              href: "/admin",
              action: () => {
                setNavLoading(true);
                closeMobileMenu();
                router.push("/admin");
              },
            }] : []),
        { key: "pgp", label: "PGP* for Crypto", href: "https://pgpforcrypto.org", external: true },
        {
          key: "logout",
          label: "Log Out",
          action: async () => {
            closeMobileMenu();
            try {
              await signOut({ callbackUrl: "/" });
            } catch {
              router.push("/");
            }
          },
        },
      ]
    : [
        { key: "home", label: "Home", href: "/" },
        {
          key: "join",
          label: "Join",
          href: `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&reason=signup`,
        },
        {
          key: "signin",
          label: "Sign In",
          action: async () => {
            closeMobileMenu();
            await handleSignIn();
          },
        },
        { key: "pgp", label: "PGP* for Crypto", href: "https://pgpforcrypto.org", external: true },
      ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-gradient-to-br from-[#0b0b43] via-[#12124f] to-[#1d1c72] text-white shadow-[0_22px_48px_-32px_rgba(11,11,67,0.65)] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link
          href="/"
          className="flex items-center gap-3 text-sm font-bold uppercase tracking-[0.4em] text-white"
        >
          <span className="relative inline-flex h-9 w-9 overflow-hidden rounded-full border border-white/20 bg-white/10">
            <Image
              src="/pgp_profile_image.png"
              alt="PGP profile"
              fill
              sizes="36px"
              className="object-cover"
              priority
            />
          </span>
          PGP Community
        </Link>
        <NavigationMenu className="hidden items-center gap-2 lg:flex">
          <NavigationMenuList className="space-x-2">
            <NavigationMenuItem>
              <NavigationMenuLink className={linkClasses} asChild>
                <Link href="/">Home</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {authenticated && (
              <NavigationMenuItem>
                <NavigationMenuLink className={linkClasses} asChild>
                  <Link href="/settings/profile">Edit Profile</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            )}

            {authenticated && isAdmin && (
              <NavigationMenuItem>
                <button
                  type="button"
                  className={linkClasses}
                  onClick={() => {
                    setNavLoading(true);
                    router.push("/admin");
                  }}
                >
                  Admin
                </button>
              </NavigationMenuItem>
            )}

            {!authenticated && (
              <NavigationMenuItem>
                <NavigationMenuLink className={linkClasses} asChild>
                  <Link href={`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&reason=signup`}>
                    Sign Up
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            )}

            {!authenticated && (
              <NavigationMenuItem>
                <button type="button" className={linkClasses} onClick={handleSignIn}>
                  Sign In
                </button>
              </NavigationMenuItem>
            )}

            {authenticated && (
              <NavigationMenuItem>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await signOut({ callbackUrl: "/" });
                    } catch {
                      router.push("/");
                    }
                  }}
                  className={linkClasses}
                >
                  Log Out
                </button>
              </NavigationMenuItem>
            )}

            <NavigationMenuItem className="pl-3">
              <NavigationMenuLink className={externalLinkClasses} asChild>
                <Link href="https://pgpforcrypto.org" target="_blank" rel="noopener noreferrer">
                  PGP* for Crypto
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
            {navLoading && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading…
              </span>
            )}
          </NavigationMenuList>
        </NavigationMenu>
        <div className="relative flex items-center lg:hidden">
          <button
            type="button"
            className={mobileToggleClasses}
            aria-expanded={mobileOpen}
            aria-controls={mobileMenuId}
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            <span className="sr-only">Toggle navigation</span>
            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
          {mobileOpen && (
            <div
              id={mobileMenuId}
              className="absolute right-0 top-[calc(100%+0.75rem)] w-[min(20rem,calc(100vw-2.5rem))] rounded-3xl border border-white/15 bg-[rgba(11,11,67,0.94)] p-4 shadow-[0_18px_36px_-20px_rgba(11,11,67,0.65)] backdrop-blur-xl"
            >
              <div className="space-y-3">
                {mobileMenuItems.map((item) =>
                  item.action ? (
                    <button
                      key={item.key}
                      type="button"
                      className={mobileMenuItemClasses}
                      onClick={item.action}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <Link
                      key={item.key}
                      href={item.href!}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noopener noreferrer" : undefined}
                      className={mobileMenuItemClasses}
                      onClick={closeMobileMenu}
                    >
                      {item.label}
                    </Link>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
