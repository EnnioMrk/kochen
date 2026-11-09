import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Camera,
  ChefHat,
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
import { logout, setDevToken, devToken as currentDevToken } from "../lib/api";
import { Avatar, Button, Input } from "./ui";

const NAV = [
  { to: "/", label: "Meine Rezepte", icon: BookOpen, end: true },
  { to: "/entdecken", label: "Entdecken", icon: Compass },
  { to: "/suche", label: "Suche", icon: Search },
  { to: "/einkauf", label: "Einkauf", icon: ShoppingBasket },
  { to: "/freunde", label: "Freunde", icon: Users },
];

const BOTTOM = [
  { to: "/", label: "Rezepte", icon: BookOpen, end: true },
  { to: "/suche", label: "Suche", icon: Search },
  { to: "/erfassen", label: "Erfassen", icon: Camera },
  { to: "/einkauf", label: "Einkauf", icon: ShoppingBasket },
  { to: "/freunde", label: "Freunde", icon: Users },
];

export function AppShell() {
  const { data: me, isError, error, refetch, isLoading } = useMe();
  const location = useLocation();
  const [dev, setDev] = useState(currentDevToken());
  const [showDev, setShowDev] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex items-center gap-3 text-ink-soft">
          <ChefHat className="size-6 animate-pulse text-brand" />
          <span className="text-sm">Kochen wird geladen …</span>
        </div>
      </div>
    );
  }

  if (isError || !me) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "unauthenticated" || code === "not_member") {
      return (
        <div className="paper-grain flex min-h-dvh items-center justify-center px-4 py-16">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center">
              <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20">
                <ChefHat className="size-7" />
              </span>
              <h1 className="text-3xl">Kochen</h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {code === "not_member"
                  ? "Dein Konto ist angemeldet, hat aber noch keinen Zugang. Stelle eine Anfrage – der Betreiber gibt sie frei."
                  : "Bitte melde dich mit deinem ennio.vip-Konto an."}
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-line bg-white/80 p-5 shadow-sm">
              {code === "not_member" ? (
                <Button
                  className="w-full"
                  onClick={() => window.EnnioAuth?.requestAccess?.()}
                >
                  Zugang anfragen
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => window.EnnioAuth?.login?.()}
                >
                  Anmelden
                </Button>
              )}
              <button
                className="mt-4 w-full text-center text-xs text-ink-soft underline-offset-4 hover:underline"
                onClick={() => setShowDev((value) => !value)}
              >
                Lokale Entwicklung?
              </button>
              {showDev && (
                <div className="mt-3 space-y-2">
                  <Input value={dev} onChange={(event) => setDev(event.target.value)} placeholder="dev:sub:email:Name" />
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      setDevToken(dev);
                      void refetch();
                    }}
                  >
                    Mit Dev-Token laden
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-6 text-center text-xs text-ink-soft">
              Zugang nur für freigegebene Konten. Keine öffentliche Seite.
            </p>
          </div>
        </div>
      );
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
    <div className="min-h-dvh pb-24 sm:pb-10">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="mr-2 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
              <ChefHat className="size-5" />
            </span>
            <span className="display hidden text-xl tracking-tight sm:block">Kochen</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
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
              to="/benachrichtigungen"
              className="relative inline-flex size-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
              aria-label="Benachrichtigungen"
            >
              <Bell className="size-5" />
              {(me.unreadNotifications ?? 0) > 0 && (
                <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
                  {me.unreadNotifications}
                </span>
              )}
            </Link>
            <Link to={`/profil/${me.id}`} className="ml-1" aria-label="Mein Profil">
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

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur-md sm:hidden" style={{ paddingBottom: "var(--safe-bottom)" }}>
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-2">
          {BOTTOM.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "tap flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-medium",
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
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Link
        to="/einstellungen"
        className="fixed bottom-5 right-4 z-30 hidden size-11 items-center justify-center rounded-full border border-line bg-white text-ink-soft shadow-md transition hover:text-ink sm:flex"
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
