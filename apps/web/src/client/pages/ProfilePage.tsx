import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Profile } from "@kochen/contracts";
import { BookOpen, ChevronLeft, Settings, UserPlus, Users } from "lucide-react";
import { api, qk } from "../lib/api";
import { useMe } from "../lib/session";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "../components/ui";
import { RecipeCard } from "../components/social/RecipeRow";

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xl">{title}</h2>
        <Badge tone="neutral">{count}</Badge>
      </div>
      {count === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
      )}
    </section>
  );
}

export function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = useMe();

  const profileQuery = useQuery({
    queryKey: qk.profile(id ?? ""),
    queryFn: () => api<Profile>(`/api/profiles/${id}`),
    enabled: Boolean(id),
    retry: false,
  });

  if (!id || profileQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Profil" />
        <EmptyState
          title="Profil nicht gefunden"
          body="Das Profil gibt es nicht oder du hast keinen Zugriff."
          action={
            <Button variant="secondary" onClick={() => navigate("/freunde")}>
              Zu den Freunden
            </Button>
          }
        />
      </div>
    );
  }

  if (profileQuery.isPending || !profileQuery.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Card className="flex items-center gap-4 p-5">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[4/3] w-full" />
          ))}
        </div>
      </div>
    );
  }

  const profile = profileQuery.data;
  const isSelf = me.data?.id === profile.user.id;
  const deleted = Boolean(profile.user.deletedAt);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <button
        type="button"
        className="tap inline-flex min-h-11 items-center gap-1 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
      >
        <ChevronLeft className="size-4" />
        Zurück
      </button>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={profile.user.name} url={profile.user.avatarUrl} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl break-words">{deleted ? "gelöschtes Konto" : profile.user.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isSelf && <Badge tone="brand">Dein Profil</Badge>}
              {deleted && <Badge tone="danger">gelöschtes Konto</Badge>}
              {!deleted && profile.isFriend && <Badge tone="sage">befreundet</Badge>}
              {!deleted && !isSelf && !profile.isFriend && <Badge tone="neutral">kein Kontakt</Badge>}
            </div>
          </div>
          {isSelf ? (
            <Button variant="secondary" size="sm" className="max-sm:w-full" onClick={() => navigate("/einstellungen")}>
              <Settings className="size-4" />
              Einstellungen
            </Button>
          ) : deleted ? null : (
            <Button variant="secondary" size="sm" className="max-sm:w-full" onClick={() => navigate("/freunde")}>
              <UserPlus className="size-4" />
              Einladung
            </Button>
          )}
        </div>

        {!isSelf && !profile.isFriend && !deleted && (
          <p className="mt-4 rounded-xl bg-paper-2/70 px-4 py-3 text-sm leading-relaxed text-ink-soft">
            Freundschaften entstehen nur über einen Einladungslink. Öffne „Freunde“ und teile deinen Link mit dieser
            Person. Danach bestätigt sie die Anfrage.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-sage" />
          <h2 className="text-xl">Freunde</h2>
          {profile.friends && <Badge tone="neutral">{profile.friends.length}</Badge>}
        </div>
        {profile.friends ? (
          profile.friends.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Noch keine Freunde.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {profile.friends.map((friend) => (
                <li key={friend.id}>
                  <Link
                    to={`/profil/${friend.id}`}
                    className="tap tap-target inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm text-ink transition hover:border-ink/20"
                  >
                    <Avatar name={friend.name} url={friend.avatarUrl} size={24} />
                    {friend.deletedAt ? "gelöschtes Konto" : friend.name}
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            {profile.friendListVisible
              ? "Die Freundesliste ist nicht sichtbar."
              : "Diese Person hat ihre Freundesliste ausgeblendet."}
          </p>
        )}
      </Card>

      <Section
        title="Rezepte"
        count={profile.recipes.length}
        empty={deleted ? "Keine Rezepte" : "Noch keine Rezepte"}
      >
        {profile.recipes.map((recipe) => (
          <RecipeCard key={recipe.id} recipe={recipe} />
        ))}
      </Section>

      <Section
        title="Varianten"
        count={profile.variations.length}
        empty="Noch keine Varianten"
      >
        {profile.variations.map((recipe) => (
          <RecipeCard key={recipe.id} recipe={recipe} />
        ))}
      </Section>

      <div className="flex items-center gap-2 text-xs text-ink-soft">
        <BookOpen className="size-4" />
        Private Rezepte erscheinen hier nicht.
      </div>
    </div>
  );
}
