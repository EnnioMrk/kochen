import { useEffect, useState } from "react";
import type { RecipeDetail, RecipeDiff } from "@kochen/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Camera,
  ChefHat,
  Clock,
  ExternalLink,
  Pencil,
  Play,
  Printer,
  Share2,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api, qk } from "../lib/api";
import { useMe } from "../lib/session";
import { errorText, formatDate } from "../lib/utils";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  MediaImage,
  Modal,
  Skeleton,
  Stars,
  useToast,
} from "../components/ui";
import { CommentsSection } from "../components/recipes/CommentsSection";
import { DiffView } from "../components/recipes/DiffView";
import { ExportControls } from "../components/recipes/ExportControls";
import { IngredientRows, ServingsStepper } from "../components/recipes/IngredientList";
import { ShareModal } from "../components/recipes/ShareModal";
import {
  SOURCE_LABEL,
  VISIBILITY_LABEL,
  decimal,
  durationLabel,
  ratingLabel,
  servingsLabel,
} from "../components/recipes/format";

type ConfirmAction = "archive" | "delete";

/** One gallery tile. A broken file keeps a quiet placeholder instead of a dead link. */
function GalleryTile({ url, index }: { url: string; index: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex aspect-square w-full items-center justify-center rounded-xl border border-line bg-paper-2 text-ink-soft/70">
        <Camera className="size-6" strokeWidth={1.4} aria-hidden />
        <span className="sr-only">Bild {index + 1} ist nicht verfügbar.</span>
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="block overflow-hidden rounded-xl border border-line transition hover:border-ink/25"
    >
      <img
        src={url}
        alt={`Bild ${index + 1}`}
        loading="lazy"
        onError={() => setFailed(true)}
        className="aspect-square w-full object-cover"
      />
    </a>
  );
}

export function RecipeDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();

  const [linkReady, setLinkReady] = useState(() => !searchParams.get("link"));
  const [servings, setServings] = useState<number | null>(null);
  const [forkOpen, setForkOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);

  /* The private link token lives in the URL once, then only in sessionStorage.
     api() reads `kochen.link:<id>` and sends it as x-link-token. */
  useEffect(() => {
    if (!id) return;
    const token = searchParams.get("link");
    if (token) {
      try {
        sessionStorage.setItem(`kochen.link:${id}`, token);
      } catch {
        // Storage can be blocked; the request then fails with a clear message.
      }
      const next = new URLSearchParams(searchParams);
      next.delete("link");
      setSearchParams(next, { replace: true });
    }
    setLinkReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const detail = useQuery({
    queryKey: qk.recipe(id),
    queryFn: () => api<RecipeDetail>(`/api/recipes/${id}`),
    enabled: Boolean(id) && linkReady,
  });
  const recipe = detail.data;

  const diff = useQuery({
    queryKey: qk.diff(id),
    queryFn: () => api<RecipeDiff>(`/api/recipes/${id}/diff`),
    enabled: Boolean(recipe?.parentId),
  });

  useEffect(() => {
    setServings(null);
  }, [id]);

  useEffect(() => {
    if (recipe && servings === null) setServings(recipe.servings);
  }, [recipe, servings]);

  const invalidateRecipe = () => {
    void queryClient.invalidateQueries({ queryKey: qk.recipe(id) });
    void queryClient.invalidateQueries({ queryKey: ["recipes"] });
  };

  const cook = useMutation({
    mutationFn: () =>
      api<{ state: string; count: number; lastCookedAt: string }>(
        `/api/recipes/${id}/cook`,
        { method: "POST" },
      ),
    onSuccess: () => {
      invalidateRecipe();
      toast.push("Gekocht gespeichert.", "success");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const rate = useMutation({
    mutationFn: (stars: number) =>
      api<{ myRating: number; avgRating: number | null; ratingCount: number }>(
        `/api/recipes/${id}/rating`,
        { method: "POST", body: { stars } },
      ),
    onSuccess: () => {
      invalidateRecipe();
      toast.push("Bewertung gespeichert.", "success");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "forbidden") {
        toast.push("Bewerten geht erst nach dem Kochen. Koche das Rezept zuerst.", "error");
        return;
      }
      toast.push(errorText(error), "error");
    },
  });

  const fork = useMutation({
    mutationFn: (value: number) =>
      api<RecipeDetail>(`/api/recipes/${id}/fork`, {
        method: "POST",
        body: { servings: value },
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setForkOpen(false);
      toast.push("Variante erstellt.", "success");
      navigate(`/rezept/${created.id}`);
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const archive = useMutation({
    mutationFn: () =>
      api<RecipeDetail>(`/api/recipes/${id}/archive`, { method: "POST" }),
    onSuccess: () => {
      invalidateRecipe();
      setConfirm(null);
      toast.push("Rezept archiviert.", "success");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const remove = useMutation({
    mutationFn: () =>
      api<{ deleted: boolean }>(`/api/recipes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setConfirm(null);
      toast.push("Rezept gelöscht.", "success");
      navigate("/");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  if (!id) {
    return (
      <EmptyState
        title="Rezept nicht gefunden"
        body="Der Link ist unvollständig."
        action={<Button onClick={() => navigate("/")}>Zu meinen Rezepten</Button>}
      />
    );
  }

  if (detail.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-card)]" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-72 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-56 w-full rounded-[var(--radius-card)]" />
        </div>
      </div>
    );
  }

  if (detail.isError || !recipe) {
    const code = detail.error instanceof ApiError ? detail.error.code : undefined;
    const notFound = code === "not_found";
    const forbidden = code === "forbidden";
    return (
      <EmptyState
        title={notFound ? "Rezept nicht gefunden" : forbidden ? "Kein Zugang" : "Rezept konnte nicht geladen werden"}
        body={
          notFound
            ? "Das Rezept gibt es nicht mehr oder der Link ist falsch."
            : forbidden
              ? "Dieses Rezept ist privat oder nur für Freunde sichtbar."
              : errorText(detail.error)
        }
        icon={<ChefHat className="size-8" />}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => navigate("/")}>Zu meinen Rezepten</Button>
            {!notFound && !forbidden && (
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                Erneut versuchen
              </Button>
            )}
          </div>
        }
      />
    );
  }

  const currentServings = servings ?? recipe.servings;
  const factor = recipe.servings > 0 ? currentServings / recipe.servings : 1;
  const cookStatus = recipe.myCookStatus;
  const cookedText =
    cookStatus && cookStatus.state === "cooked"
      ? `${cookStatus.count}-mal gekocht${
          cookStatus.lastCookedAt ? ` · zuletzt ${formatDate(cookStatus.lastCookedAt)}` : ""
        }`
      : "noch ungetestet";
  const gallery = recipe.images.filter((image) => image.url !== recipe.coverUrl);
  const friends = recipe.variedByFriends ?? [];
  const isOwner = Boolean(me.data && me.data.id === recipe.owner.id);
  const canRate = cookStatus?.state === "cooked";
  const categoryNames = new Set(
    recipe.categories.map((category) => category.name.toLocaleLowerCase("de")),
  );
  const ownTags = recipe.tags.filter(
    (tag) => !categoryNames.has(tag.toLocaleLowerCase("de")),
  );
  const visibleTags = showAllTags ? ownTags : ownTags.slice(0, 8);
  const hiddenTagCount = ownTags.length - 8;

  const bakingTemperature = recipe.bakingTemperature?.trim();
  const bakingTime = recipe.bakingTime?.trim();
  const bakingRows = [
    bakingTemperature ? { label: "Backtemperatur", value: bakingTemperature } : null,
    bakingTime ? { label: "Backzeit", value: bakingTime } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="relative aspect-[16/10] overflow-hidden bg-paper-2 sm:aspect-[16/9] md:aspect-auto md:min-h-80">
            <MediaImage
              src={recipe.coverUrl}
              alt={`Titelbild von ${recipe.title}`}
              className="absolute inset-0 size-full object-cover"
              fallback={
                <div className="paper-grain flex size-full min-h-48 items-center justify-center bg-[linear-gradient(135deg,var(--color-paper-2),var(--color-sage-soft))]">
                  <ChefHat className="size-16 text-brand/30" strokeWidth={1.2} />
                </div>
              }
            />
          </div>

          <div className="min-w-0 p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="sage">{VISIBILITY_LABEL[recipe.visibility]}</Badge>
              <Badge>{SOURCE_LABEL[recipe.sourceType]}</Badge>
              {recipe.archivedAt && <Badge tone="gold">Archiviert</Badge>}
              {recipe.cookedByMe && (
                <Badge tone="sage">
                  <UtensilsCrossed className="size-3" />
                  Gekocht
                </Badge>
              )}
              {recipe.parentId && <Badge tone="brand">Variante</Badge>}
            </div>

            <h1 className="mt-3 text-3xl leading-tight break-words sm:text-4xl">{recipe.title}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <Avatar name={recipe.owner.name} url={recipe.owner.avatarUrl} size={24} />
              {recipe.owner.deletedAt ? (
                <span>gelöschtes Konto</span>
              ) : (
                <Link
                  to={`/profil/${recipe.owner.id}`}
                  className="underline-offset-4 hover:text-ink hover:underline"
                >
                  {recipe.owner.name}
                </Link>
              )}
              <span aria-hidden>·</span>
              <span>{formatDate(recipe.createdAt)}</span>
            </div>

            {recipe.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {recipe.description}
              </p>
            )}

            {(recipe.tags.length > 0 || recipe.categories.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recipe.categories.map((category) => (
                  <Badge key={category.id} tone="brand">
                    {category.name}
                  </Badge>
                ))}
                {visibleTags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
                {hiddenTagCount > 0 && (
                  <button
                    type="button"
                    aria-expanded={showAllTags}
                    onClick={() => setShowAllTags((current) => !current)}
                    className="inline-flex items-center rounded-full bg-ink/5 px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-ink/10 hover:text-ink"
                  >
                    {showAllTags ? "weniger anzeigen" : `+${hiddenTagCount} weitere`}
                  </button>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-sm font-medium text-ink">Deine Bewertung</span>
                <Stars
                  value={recipe.myRating ?? null}
                  size={26}
                  readOnly={!canRate}
                  onChange={canRate ? (stars) => rate.mutate(stars) : undefined}
                />
                <span className="text-xs text-ink-soft">
                  {recipe.myRating
                    ? `${decimal(recipe.myRating)} von 5`
                    : canRate
                      ? "Noch nicht bewertet."
                      : "Noch offen."}
                </span>
                {rate.isPending && <span className="text-xs text-ink-soft">speichert …</span>}
              </div>
              {recipe.avgRating != null && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <Stars value={recipe.avgRating} readOnly size={16} />
                  <span>{ratingLabel(recipe.avgRating, recipe.ratingCount)}</span>
                </div>
              )}
              <p className="text-xs text-ink-soft">
                {canRate
                  ? cookedText
                  : "Bewerten ist erst nach dem ersten Kochen möglich."}
              </p>
            </div>

            {friends.length > 0 && (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-paper-2/60 px-3 py-2">
                <div className="flex -space-x-2">
                  {friends.slice(0, 5).map((friend) => (
                    <Avatar key={friend.id} name={friend.name} url={friend.avatarUrl} size={22} />
                  ))}
                </div>
                <span className="text-xs text-ink-soft">
                  {friends.length === 1
                    ? "1 Freund hat eine Variante erstellt"
                    : `${friends.length} Freunde haben Varianten erstellt`}
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button className="col-span-2 sm:col-auto" onClick={() => navigate(`/rezept/${id}/kochen`)}>
          <Play className="size-4" />
          Kochen
        </Button>
        {recipe.canEdit && (
          <Button
            variant="secondary"
            onClick={() => navigate(`/rezept/${id}/bearbeiten`)}
          >
            <Pencil className="size-4" />
            Bearbeiten
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => navigate(`/rezept/${id}/drucken`)}
        >
          <Printer className="size-4" />
          Drucken
        </Button>
        <Button variant="secondary" onClick={() => setShareOpen(true)}>
          <Share2 className="size-4" />
          Teilen
        </Button>
        <ExportControls recipeId={id} title={recipe.title} className="col-span-2 sm:col-auto" />
        <Button
          variant="sage"
          loading={cook.isPending}
          onClick={() => cook.mutate()}
        >
          <UtensilsCrossed className="size-4" />
          Gekocht
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl">Zutaten</h2>
              <ServingsStepper
                value={currentServings}
                base={recipe.servings}
                onChange={setServings}
              />
            </div>
            {currentServings !== recipe.servings && (
              <p className="mt-2 text-xs text-ink-soft">
                Mengen für {servingsLabel(currentServings)}. Nur zur Anzeige – das
                Rezept bleibt bei {recipe.servings} Portionen.
              </p>
            )}
            <IngredientRows
              ingredients={recipe.ingredients}
              factor={factor}
              className="mt-3"
            />
            {bakingRows.length > 0 && (
              <dl className="mt-3 space-y-1 rounded-xl bg-paper-2/60 px-3 py-2 text-sm">
                {bakingRows.map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-soft">{row.label}</dt>
                    <dd className="min-w-0 break-words text-right text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button variant="secondary" size="sm" onClick={() => setForkOpen(true)}>
                Als Variante übernehmen
              </Button>
              <span className="text-xs text-ink-soft">
                Erstellt ein neues Rezept mit diesen Mengen.
              </span>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-xl">Schritte</h2>
            {recipe.steps.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">Keine Schritte eingetragen.</p>
            ) : (
              <ol className="mt-3 space-y-4">
                {recipe.steps.map((step, index) => (
                  <li key={step.id ?? `step-${index}`} className="flex gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sage-soft text-sm font-semibold text-sage-text">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                        {step.text}
                      </p>
                      {step.durationS ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-soft">
                          <Clock className="size-3.5" />
                          {durationLabel(step.durationS)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {recipe.parentId && (
            <Card className="p-5">
              <h2 className="text-xl">Vergleich mit dem Original</h2>
              {diff.isLoading && (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}
              {diff.isError && (
                <div className="mt-2 text-sm">
                  <p>Der Vergleich konnte nicht geladen werden.</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 px-0"
                    onClick={() => void diff.refetch()}
                  >
                    Erneut versuchen
                  </Button>
                </div>
              )}
              {diff.data && (
                <div className="mt-3">
                  <DiffView diff={diff.data} />
                </div>
              )}
              <p className="mt-4 text-xs text-ink-soft">
                <Link
                  to={`/rezept/${recipe.parentId}`}
                  className="underline-offset-4 hover:text-ink hover:underline"
                >
                  Original öffnen
                </Link>
              </p>
            </Card>
          )}

          <Card className="p-5">
            <CommentsSection
              recipeId={id}
              canComment={recipe.canComment}
              isOwner={isOwner}
              currentUserId={me.data?.id}
            />
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card className="p-5">
            <h2 className="text-base">Details</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Portionen</dt>
                <dd>{recipe.servings}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Sichtbarkeit</dt>
                <dd>{VISIBILITY_LABEL[recipe.visibility]}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Quelle</dt>
                <dd>{SOURCE_LABEL[recipe.sourceType]}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Erstellt</dt>
                <dd>{formatDate(recipe.createdAt)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Geändert</dt>
                <dd>{formatDate(recipe.updatedAt)}</dd>
              </div>
              {recipe.depth > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-soft">Variante</dt>
                  <dd>Stufe {recipe.depth}</dd>
                </div>
              )}
              {recipe.originalLang && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-soft">Sprache</dt>
                  <dd>{recipe.originalLang}</dd>
                </div>
              )}
            </dl>
          </Card>

          {(recipe.sourceUrl || recipe.rawText || recipe.transcript) && (
            <Card className="p-5">
              <h2 className="text-base">Quelle</h2>
              {recipe.sourceUrl && (
                <a
                  href={recipe.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-flex items-center gap-1.5 break-all text-sm text-brand underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-4 shrink-0" />
                  {recipe.sourceUrl}
                </a>
              )}
              {recipe.rawText && (
                <details className="mt-3 rounded-xl border border-line bg-white/70 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    Originaltext
                  </summary>
                  <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-soft">
                    {recipe.rawText}
                  </p>
                </details>
              )}
              {recipe.transcript && (
                <details className="mt-2 rounded-xl border border-line bg-white/70 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    Transkript
                  </summary>
                  <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-soft">
                    {recipe.transcript}
                  </p>
                </details>
              )}
            </Card>
          )}

          {gallery.length > 0 && (
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-base">
                <Camera className="size-4 text-ink-soft" />
                Bilder
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {gallery.map((image, index) => (
                  <GalleryTile
                    key={image.id ?? `image-${index}`}
                    url={image.url}
                    index={index}
                  />
                ))}
              </div>
            </Card>
          )}

          {recipe.canEdit && (
            <Card className="space-y-2 p-5">
              <h2 className="text-base">Verwalten</h2>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => setConfirm("archive")}
              >
                <Archive className="size-4" />
                Archivieren
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="w-full"
                onClick={() => setConfirm("delete")}
              >
                <Trash2 className="size-4" />
                Löschen
              </Button>
              <p className="text-xs leading-relaxed text-ink-soft">
                Löschen blendet das Rezept aus. Varianten bleiben sichtbar.
              </p>
            </Card>
          )}
        </aside>
      </div>

      <Modal
        open={forkOpen}
        onClose={() => setForkOpen(false)}
        title="Als Variante übernehmen"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForkOpen(false)}>
              Abbrechen
            </Button>
            <Button
              loading={fork.isPending}
              onClick={() => fork.mutate(currentServings)}
            >
              Variante erstellen
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            Das Rezept wird als neue Variante kopiert. Die Portionszahl wird
            dabei gesetzt. Prüfe die Mengen danach im Editor.
          </p>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink">Portionen</span>
            <ServingsStepper
              value={currentServings}
              base={recipe.servings}
              onChange={setServings}
            />
          </div>
          <p className="text-xs text-ink-soft">
            Du kannst die Variante danach bearbeiten und als eigenes Rezept
            speichern.
          </p>
        </div>
      </Modal>

      <ShareModal
        recipeId={id}
        visibility={recipe.visibility}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "delete" ? "Rezept löschen" : "Rezept archivieren"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Abbrechen
            </Button>
            <Button
              variant={confirm === "delete" ? "danger" : "primary"}
              loading={archive.isPending || remove.isPending}
              onClick={() => {
                if (confirm === "delete") remove.mutate();
                else archive.mutate();
              }}
            >
              {confirm === "delete" ? "Löschen" : "Archivieren"}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          {confirm === "delete"
            ? "Das Rezept wird weich gelöscht und ausgeblendet. Varianten bleiben sichtbar. Löschen ist nicht rückgängig zu machen."
            : "Das Rezept verschwindet aus der Liste und landet im Archiv. Du kannst es dort wiederherstellen."}
        </p>
      </Modal>
    </div>
  );
}
