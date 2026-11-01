"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import ExamInterface, { type AnswersMap, type ExamData } from "@/components/exam/ExamInterface";
import { useAuthUser } from "@/lib/useAuthUser";

/** Persistent per-browser id — lets the start endpoint tell "same computer, reloading" from "different computer, trying to log in too". */
function getDeviceFingerprint(): string {
  const key = "cbt-device-id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}

/** Holds the useSearchParams() call — needs a Suspense boundary above it, see the default export below. */
function StudentExamContent() {
  const params = useParams<{ examId: string }>();
  const searchParams = useSearchParams();
  const batchId = searchParams.get("batch") ?? "";
  const router = useRouter();
  const authUser = useAuthUser();

  const [state, setState] = useState<"loading" | "error" | "ready" | "submitted">("loading");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ sessionId: string; exam: ExamData; existingAnswers: AnswersMap } | null>(null);
  const [submissionResult, setSubmissionResult] = useState<{
    showResultInstantly: boolean;
    allowReview: boolean;
    objectiveScore: number;
    maxScore: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/exam-sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ examId: params.examId, batchId, deviceFingerprint: getDeviceFingerprint() }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't start this exam.");
          setState("error");
          return;
        }
        setSession(data);
        setState("ready");
      } catch {
        if (!cancelled) {
          setError("Couldn't reach the server. Check your network connection and reload.");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutoSave = async (answers: AnswersMap) => {
    if (!session) return;
    const res = await fetch("/api/exam-sessions/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, answers }),
    });
    if (!res.ok) throw new Error("Autosave failed");
  };

  const handleSubmit = async (answers: AnswersMap) => {
    if (!session) return;
    const res = await fetch("/api/exam-sessions/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, answers }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error ?? "Couldn't submit your exam. Your answers are still saved — try again.");
    }
    // Was previously discarded entirely — the endpoint has always computed
    // showResultInstantly correctly, but nothing here ever looked at it, so
    // every submission silently redirected the same way regardless of the
    // exam's setting.
    setSubmissionResult({
      showResultInstantly: !!data.showResultInstantly,
      allowReview: !!data.allowReview,
      objectiveScore: data.objectiveScore ?? 0,
      maxScore: data.maxScore ?? 0,
    });
    setState("submitted");
  };

  if (state === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cream-50 dark:bg-[#101114]">
        <Loader2 size={22} className="animate-spin text-crimson-600" />
        <p className="text-[13px] text-ink/50 dark:text-white/50">Starting your exam…</p>
      </div>
    );
  }

  if (state === "error" || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cream-50 dark:bg-[#101114] px-6 text-center">
        <AlertTriangle size={24} className="text-crimson-600" />
        <p className="max-w-sm text-[14px] text-ink dark:text-white">{error}</p>
        <button onClick={() => router.push("/student")} className="mt-2 rounded-lg bg-crimson-600 px-4 py-2.5 text-[13px] font-semibold text-on-crimson hover:bg-crimson-700">
          Back to Exam Launchpad
        </button>
      </div>
    );
  }

  if (state === "submitted" && submissionResult) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cream-50 dark:bg-[#101114] px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 size={28} />
        </div>
        <p className="text-[15px] font-semibold text-ink dark:text-white">Exam submitted</p>
        {submissionResult.showResultInstantly ? (
          <>
            <p className="text-[13px] text-ink/50 dark:text-white/50">Your score</p>
            <p className="font-display text-[32px] font-bold text-crimson-600">
              {submissionResult.objectiveScore}/{submissionResult.maxScore}
            </p>
          </>
        ) : (
          <p className="max-w-sm text-[13.5px] leading-relaxed text-ink/60 dark:text-white/60">
            Your answers are recorded. Your teacher will publish your result once it's ready.
          </p>
        )}
        <button onClick={() => router.push("/student")} className="mt-3 rounded-lg bg-crimson-600 px-4 py-2.5 text-[13px] font-semibold text-on-crimson hover:bg-crimson-700">
          Back to Exam Launchpad
        </button>
        {submissionResult.allowReview && (
          <button
            onClick={() => router.push(`/student/exam/${params.examId}/review`)}
            className="rounded-lg border border-black/10 dark:border-white/15 px-4 py-2.5 text-[13px] font-medium text-ink/70 dark:text-white/70 hover:bg-black/5"
          >
            Review your answers
          </button>
        )}
      </div>
    );
  }

  return (
    <ExamInterface
      exam={session.exam}
      sessionId={session.sessionId}
      studentName={authUser?.fullName ?? ""}
      initialAnswers={session.existingAnswers}
      onAutoSave={handleAutoSave}
      onSubmit={handleSubmit}
    />
  );
}

export default function StudentExamPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cream-50 dark:bg-[#101114]">
          <Loader2 size={22} className="animate-spin text-crimson-600" />
        </div>
      }
    >
      <StudentExamContent />
    </Suspense>
  );
}
