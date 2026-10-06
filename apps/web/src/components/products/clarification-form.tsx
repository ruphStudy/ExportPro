"use client";

import * as React from "react";
import type { ClarificationAnswer, ClarificationQuestion } from "@exportpro/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HelperText } from "@/components/ui/typography";

/** Structured answers to the analysis' targeted questions — not a chat. */
export function ClarificationForm({
  questions,
  previousAnswers,
  submitting,
  submitLabel = "Re-analyze with answers",
  onSubmit,
}: {
  questions: ClarificationQuestion[];
  previousAnswers: ClarificationAnswer[];
  submitting: boolean;
  submitLabel?: string;
  onSubmit: (answers: { questionId: string; answer: string }[]) => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(previousAnswers.map((a) => [a.questionId, a.answer])),
  );
  const [error, setError] = React.useState<string | null>(null);
  const set = (id: string, value: string) => setValues((v) => ({ ...v, [id]: value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const answers = questions
      .map((q) => ({ questionId: q.id, answer: (values[q.id] ?? "").trim() }))
      .filter((a) => a.answer.length > 0);
    if (answers.length === 0) {
      setError("Answer at least one question.");
      return;
    }
    setError(null);
    onSubmit(answers);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {questions.map((q) => {
        const value = values[q.id] ?? "";
        const isOption = q.options.includes(value);
        return (
          <fieldset key={q.id} className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">{q.question}</legend>
            {q.options.length > 0 && (
              <div role="radiogroup" aria-label={q.question} className="flex flex-wrap gap-2">
                {q.options.map((option) => {
                  const checked = value === option;
                  return (
                    <label
                      key={option}
                      className={cn(
                        "cursor-pointer rounded-full border px-3 py-1.5 text-xs focus-within:ring-2 focus-within:ring-ring",
                        checked ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border bg-surface hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name={`clarify-${q.id}`}
                        value={option}
                        checked={checked}
                        onChange={() => set(q.id, option)}
                        className="sr-only"
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            )}
            {q.allowFreeText &&
              (q.id === "product_description" ? (
                <Textarea
                  aria-label={q.question}
                  value={value}
                  maxLength={500}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder="e.g. 100% cotton knitted round-neck T-shirts for men"
                />
              ) : (
                <Input
                  aria-label={q.options.length > 0 ? `${q.question} — other answer` : q.question}
                  value={isOption ? "" : value}
                  maxLength={500}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder={q.options.length > 0 ? "Or type your own answer" : "Your answer"}
                />
              ))}
          </fieldset>
        );
      })}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
        <HelperText>Only answer what you know — unanswered questions are skipped.</HelperText>
      </div>
    </form>
  );
}
