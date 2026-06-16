import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getSession = vi.fn();
const onAuthStateChange = vi.fn((_cb: unknown) => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
const signInWithOtp = vi.fn();
const signOut = vi.fn();

vi.mock("../lib/supabaseClient", () => ({
  supabase: { auth: { getSession: () => getSession(), onAuthStateChange: (cb: unknown) => onAuthStateChange(cb), signInWithOtp: (a: unknown) => signInWithOtp(a), signOut: () => signOut() } },
}));
const getProfile = vi.fn();
const clearGameCode = vi.fn();
vi.mock("../lib/profile", () => ({
  getProfile: () => getProfile(),
  clearGameCode: () => clearGameCode(),
}));

import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./useAuth";

function Probe() {
  const { loading, session, profile } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>session:{session ? "yes" : "no"} name:{profile?.display_name ?? "none"}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
  clearGameCode.mockResolvedValue(undefined);
});

describe("AuthProvider", () => {
  it("exposes no session when getSession is empty", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText(/session:no/)).toBeInTheDocument());
  });
  it("loads the profile when a session exists", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    getProfile.mockResolvedValue({ id: "u1", display_name: "Q", avatar: "😀", current_game_code: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText(/name:Q/)).toBeInTheDocument());
  });
  it("still resolves loading when getProfile rejects on initial load", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    getProfile.mockRejectedValue(new Error("network down"));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText(/session:yes name:none/)).toBeInTheDocument());
  });
  it("signOut releases the game code before ending the session", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    getProfile.mockResolvedValue({ id: "u1", display_name: "Q", avatar: "😀", current_game_code: "ABC234" });
    const order: string[] = [];
    clearGameCode.mockImplementation(() => { order.push("clear"); return Promise.resolve(); });
    signOut.mockImplementation(() => { order.push("signOut"); return Promise.resolve({ error: null }); });

    function LogoutProbe() {
      const { loading, signOut: doSignOut } = useAuth();
      if (loading) return <div>loading</div>;
      return <button onClick={() => doSignOut()}>logout</button>;
    }
    render(<AuthProvider><LogoutProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("logout")).toBeInTheDocument());
    await userEvent.click(screen.getByText("logout"));
    await waitFor(() => expect(order).toEqual(["clear", "signOut"]));
  });
});
