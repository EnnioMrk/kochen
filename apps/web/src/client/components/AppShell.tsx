import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Camera,
  Compass,
  LogOut,
  Search,
  Settings,
  ShoppingBasket,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useMe } from "../lib/session";
import { logout } from "../lib/api";
import { Avatar, Button } from "./ui";
import { AuthGate, LoadingScreen } from "./AuthGate";

const NAV = [
  { to: "/", label: "Rezepte", icon: BookOpen, end: true },
  { to: "/entdecken", label: "Entdecken", icon: Compass },
  { to: "/suche", label: "Suche", icon: Search },
  { to: "/einkauf", label: "Einkauf", icon: ShoppingBasket },
  { to: "/freunde", label: "Freunde", icon: Users },
];

const BOTTOM = [
  { to: "/", label: "Rezepte", icon: BookOpen, end: true },
  { to: "/entdecken", label: "Entdecken", icon: Compass },
  { to: "/erfassen", label: "Erfassen", icon: Camera },
  { to: "/einkauf", label: "Einkauf", icon: ShoppingBasket },
  { to: "/freunde", label: "Freunde", icon: Users },
];

export function AppShell() {
  const { data: me, isError, error, refetch, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) return <LoadingScreen />;

  if (isError || !me) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "unauthenticated" || code === "not_member") {
      return <AuthGate code={code} onRetry={() => void refetch()} />;
    }
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl">Das hat nicht geklappt</h1>
        <p className="text-sm text-ink-soft">{(error as Error | null)?.message ?? "Bitte später erneut versuchen."}</p>
        <Button variant="secondary" onClick={() => void refetch()}>
          Erneut versuchen
        </Button>
      </div>
    );
  }

  const onCooking = /^\/rezept\/[^/]+\/kochen/.test(location.pathname);
  const onPrint = /\/drucken$/.test(location.pathname);
  if (onCooking || onPrint) return <Outlet />;

  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <header
        className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-md"
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="mr-2 flex items-center gap-2" aria-label="Zur Rezeptliste">
            <img src="/icon.svg" alt="" aria-hidden className="size-9" />
            <span className="display hidden text-xl tracking-tight sm:block" aria-hidden>Kochen</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition",
                    isActive ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:bg-white/70 hover:text-ink",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link
              to="/suche"
              className="tap tap-target inline-flex size-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink md:hidden"
              aria-label="Suche"
            >
              <Search className="size-5" />
            </Link>
            <Link
              to="/benachrichtigungen"
              className="tap tap-target relative inline-flex size-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
              aria-label="Benachrichtigungen"
            >
              <Bell className="size-5" />
              {(me.unreadNotifications ?? 0) > 0 && (
                <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
                  {me.unreadNotifications}
                </span>
              )}
            </Link>
            <Link to={`/profil/${me.id}`} className="tap tap-target ml-1 inline-flex items-center justify-center" aria-label="Mein Profil">
              <Avatar name={me.name} url={me.avatarUrl} size={34} />
            </Link>
            <button
              onClick={() => void logout()}
              aria-label="Abmelden"
              title="Abmelden"
              className="hidden size-9 items-center justify-center rounded-full text-ink-soft transition hover:bg-ink/5 sm:inline-flex"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <Outlet context={{ me }} />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur-md md:hidden"
        style={{
          paddingBottom: "var(--safe-bottom)",
          paddingLeft: "var(--safe-left)",
          paddingRight: "var(--safe-right)",
        }}
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-2">
          {BOTTOM.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "tap flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-2.5 text-[10px] font-medium",
                  isActive ? "text-brand" : "text-ink-soft",
                  item.to === "/erfassen" && "relative",
                )
              }
            >
              {item.to === "/erfassen" ? (
                <span className="-mt-5 mb-0.5 flex size-11 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/25">
                  <item.icon className="size-5" />
                </span>
              ) : (
                <item.icon className="size-5" />
              )}
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <Link
        to="/einstellungen"
        className="fixed right-[calc(1rem+var(--safe-right))] z-30 hidden size-11 items-center justify-center rounded-full border border-line bg-white text-ink-soft shadow-md transition hover:text-ink md:flex"
        style={{ bottom: "calc(1.25rem + var(--safe-bottom))" }}
        aria-label="Einstellungen"
      >
        <Settings className="size-5" />
      </Link>
    </div>
  );
}

export function ProfileLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link to={`/profil/${id}`} className="inline-flex items-center gap-2 text-ink-soft underline-offset-4 hover:text-ink hover:underline">
      <UserRound className="size-4" />
      {children}
    </Link>
  );
}
