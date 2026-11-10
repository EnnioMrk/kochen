import { useState } from "react";
import type { Comment } from "@kochen/contracts";
import { MessageSquare, Reply, Send, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "../../lib/api";
import { cn, errorText, relativeTime } from "../../lib/utils";
import { Avatar, Button, Spinner, Textarea, useToast } from "../ui";

function authorName(comment: Comment): string {
  if (comment.author.deletedAt) return "gelöschtes Konto";
  return comment.author.name;
}

function CommentBody({ comment }: { comment: Comment }) {
  if (comment.deletedAt) {
    return <p className="text-sm italic text-ink-soft">gelöschter Kommentar</p>;
  }
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
      {comment.body}
    </p>
  );
}

function CommentRow({
  comment,
  reply,
  onReply,
  onDelete,
  canDelete,
  canReply,
  deleting,
}: {
  comment: Comment;
  reply?: boolean;
  onReply?: () => void;
  onDelete?: () => void;
  canDelete: boolean;
  canReply: boolean;
  deleting: boolean;
}) {
  return (
    <div className={cn("flex gap-3", reply && "gap-2.5")}>
      <Avatar
        name={comment.author.deletedAt ? "?" : comment.author.name}
        url={comment.author.deletedAt ? null : comment.author.avatarUrl}
        size={reply ? 26 : 32}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-ink">{authorName(comment)}</span>
          <span className="text-xs text-ink-soft">{relativeTime(comment.createdAt)}</span>
        </div>
        <div className="mt-1">
          <CommentBody comment={comment} />
        </div>
        {!comment.deletedAt && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {canReply && onReply && (
              <Button variant="ghost" size="sm" className="min-h-9 px-2 text-xs" onClick={onReply}>
                <Reply className="size-3.5" />
                Antworten
              </Button>
            )}
            {canDelete && onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9 px-2 text-xs text-danger"
                loading={deleting}
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" />
                Löschen
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommentsSection({
  recipeId,
  canComment,
  isOwner,
  currentUserId,
}: {
  recipeId: string;
  canComment: boolean;
  isOwner: boolean;
  currentUserId?: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const comments = useQuery({
    queryKey: qk.comments(recipeId),
    queryFn: () => api<Comment[]>(`/api/recipes/${recipeId}/comments`),
  });

  const add = useMutation({
    mutationFn: (input: { body: string; parentId: string | null }) =>
      api<{ id: string; comments: Comment[] }>(`/api/recipes/${recipeId}/comments`, {
        method: "POST",
        body: { body: input.body, parentId: input.parentId },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.comments(recipeId), data.comments);
      setBody("");
      setReplyBody("");
      setReplyTo(null);
      toast.push("Kommentar gespeichert.", "success");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      api<{ deleted: boolean }>(`/api/recipes/${recipeId}/comments/${commentId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.comments(recipeId) });
      toast.push("Kommentar gelöscht.", "success");
    },
    onError: (error) => toast.push(errorText(error), "error"),
    onSettled: () => setDeletingId(null),
  });

  const roots = comments.data ?? [];
  const total = roots.reduce((sum, root) => sum + 1 + (root.replies?.length ?? 0), 0);

  const submit = (text: string, parentId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.push("Bitte Text eingeben.", "error");
      return;
    }
    if (trimmed.length > 4000) {
      toast.push("Der Kommentar ist zu lang.", "error");
      return;
    }
    add.mutate({ body: trimmed, parentId });
  };

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-xl">
        <MessageSquare className="size-5 text-ink-soft" />
        Kommentare
        <span className="text-sm font-normal text-ink-soft">({total})</span>
      </h2>

      {comments.isLoading && (
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner className="size-4" />
          Kommentare werden geladen …
        </div>
      )}

      {comments.isError && (
        <div className="rounded-xl border border-line bg-white px-3 py-2 text-sm">
          <p className="text-ink">Kommentare konnten nicht geladen werden.</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 px-0"
            onClick={() => void comments.refetch()}
          >
            Erneut versuchen
          </Button>
        </div>
      )}

      {!comments.isLoading && !comments.isError && roots.length === 0 && (
        <p className="text-sm text-ink-soft">
          Noch keine Kommentare. Schreib den ersten.
        </p>
      )}

      <ul className="space-y-5">
        {roots.map((root) => {
          const replies = root.replies ?? [];
          const canDelete = Boolean(
            currentUserId && (root.author.id === currentUserId || isOwner),
          ) && !root.deletedAt;
          return (
            <li key={root.id} className="space-y-2">
              <CommentRow
                comment={root}
                canReply={canComment && !root.deletedAt}
                canDelete={canDelete}
                deleting={deletingId === root.id}
                onReply={() => {
                  setReplyTo((current) => (current === root.id ? null : root.id));
                  setReplyBody("");
                }}
                onDelete={() => {
                  setDeletingId(root.id);
                  remove.mutate(root.id);
                }}
              />
              {replies.length > 0 && (
                <ul className="ml-9 space-y-3 border-l border-line pl-3">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentRow
                        comment={reply}
                        reply
                        canReply={false}
                        canDelete={
                          Boolean(
                            currentUserId &&
                              (reply.author.id === currentUserId || isOwner),
                          ) && !reply.deletedAt
                        }
                        deleting={deletingId === reply.id}
                        onDelete={() => {
                          setDeletingId(reply.id);
                          remove.mutate(reply.id);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {replyTo === root.id && (
                <div className="ml-9 space-y-2 border-l border-line pl-3">
                  <Textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder="Antwort schreiben …"
                    aria-label="Antwort"
                    className="min-h-20"
                    maxLength={4000}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      loading={add.isPending}
                      onClick={() => submit(replyBody, root.id)}
                    >
                      <Send className="size-3.5" />
                      Antwort senden
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReplyTo(null);
                        setReplyBody("");
                      }}
                    >
                      Abbrechen
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canComment ? (
        <div className="space-y-2 border-t border-line pt-4">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Kommentar schreiben …"
            aria-label="Kommentar"
            className="min-h-24"
            maxLength={4000}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-soft">{body.length}/4000</span>
            <Button
              loading={add.isPending}
              disabled={!body.trim()}
              onClick={() => submit(body, null)}
            >
              <Send className="size-4" />
              Kommentar senden
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-line pt-4 text-sm text-ink-soft">
          Für dieses Rezept kannst du nicht kommentieren.
        </p>
      )}
    </section>
  );
}
