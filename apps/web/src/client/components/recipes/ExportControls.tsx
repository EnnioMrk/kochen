import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDown, FileText } from "lucide-react";
import { api, qk } from "../../lib/api";
import { cn, errorText } from "../../lib/utils";
import { Button, useToast } from "../ui";

type JobStatus = {
  id: string;
  kind: string;
  state: string;
  progress: number;
  errorCode: string | null;
  url: string | null;
};

function saveFile(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function fileName(title: string, extension: string): string {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "rezept"}.${extension}`;
}

export function ExportControls({
  recipeId,
  title,
  className,
}: {
  recipeId: string;
  title: string;
  className?: string;
}) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const [finishedJob, setFinishedJob] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () =>
      api<{ jobId?: string; state: string }>(`/api/recipes/${recipeId}/export`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      if (!data.jobId) {
        toast.push("Export konnte nicht gestartet werden.", "error");
        return;
      }
      setJobId(data.jobId);
      setFinishedJob(null);
      toast.push("PDF wird erstellt. Das dauert einen Moment.");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const job = useQuery({
    queryKey: qk.job(jobId ?? "none"),
    queryFn: () => api<JobStatus>(`/api/jobs/${jobId ?? ""}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "done" || state === "failed" ? false : 2000;
    },
  });

  useEffect(() => {
    const data = job.data;
    if (!data || !jobId || finishedJob === jobId) return;
    if (data.state === "done") {
      setFinishedJob(jobId);
      setJobId(null);
      if (data.url) {
        saveFile(data.url, fileName(title, "pdf"));
        toast.push("PDF ist fertig.", "success");
      } else {
        toast.push("PDF ist fertig, aber ohne Download-Link.", "error");
      }
    } else if (data.state === "failed") {
      setFinishedJob(jobId);
      setJobId(null);
      toast.push("PDF konnte nicht erstellt werden.", "error");
    }
  }, [job.data, jobId, finishedJob, title, toast]);

  const markdown = useMutation({
    mutationFn: async () => {
      const response = await api<Response>(`/api/recipes/${recipeId}/export.md`, {
        raw: true,
      });
      return response.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      saveFile(url, fileName(title, "md"));
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.push("Markdown gespeichert.", "success");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const running = start.isPending || Boolean(jobId);

  return (
    <div className={cn("flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1", className)}>
      <Button
        variant="secondary"
        size="sm"
        loading={running}
        onClick={() => start.mutate()}
      >
        <FileDown className="size-4" />
        {running ? "PDF wird erstellt …" : "PDF"}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        loading={markdown.isPending}
        onClick={() => markdown.mutate()}
      >
        <FileText className="size-4" />
        Markdown
      </Button>
    </div>
  );
}
