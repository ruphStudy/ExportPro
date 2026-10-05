"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <ErrorState
        title="Something went wrong"
        message="An unexpected error occurred while rendering this page. No sensitive details are shown here — see the server logs for specifics."
        onRetry={reset}
        className="max-w-md"
      />
    </div>
  );
}
