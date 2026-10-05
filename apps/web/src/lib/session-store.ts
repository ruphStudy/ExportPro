import { create } from "zustand";
import type { SessionContext } from "@exportpro/types";

interface SessionState {
  session: SessionContext | null;
  isLoading: boolean;
  setSession: (session: SessionContext | null) => void;
}

export const FOUNDATION_SESSION: SessionContext = {
  user: {
    id: "foundation-user",
    email: "you@example.com",
    fullName: "Foundation User",
    avatarUrl: null,
  },
  activeOrganizationId: "foundation-org",
  memberships: [
    {
      id: "foundation-membership",
      role: "OWNER",
      status: "ACTIVE",
      organization: {
        id: "foundation-org",
        name: "Your Organization",
        slug: "your-organization",
        tradeDirections: ["EXPORT"],
      },
    },
  ],
};

/**
 * Sprint 1 has no real authentication, so this store is seeded with the
 * foundation placeholder session above instead of being hydrated from
 * an API call. Sprint 2 replaces the seed with a real `setSession()`
 * call after login/session-fetch and adds the signed-out state this
 * store already supports (`session: null`).
 */
export const useSessionStore = create<SessionState>((set) => ({
  session: FOUNDATION_SESSION,
  isLoading: false,
  setSession: (session) => set({ session }),
}));
