# heartsup Sub-project 1 — Auth + Profile + Game codes — Design Spec

**Date:** 2026-06-16
**Status:** Approved
**Depends on:** Sub-project 0 (foundation, schema, Supabase). See
[2026-06-15-heartsup-design.md](2026-06-15-heartsup-design.md) for the whole-system design.

## 1. Goal

Deliver the authenticated app shell: passwordless magic-link login, a first-login profile
setup (display name + emoji avatar), the navigable Home / Profile / How-to-Play screens, and a
per-session personal **game code** that friends will use (in SP2) to join a game. Enable the
`profiles` RLS that was deferred from SP0.

After SP1 the app is demoable end-to-end: log in → set up profile → see Home → view/copy game
code → log out.

## 2. Decisions (locked)

| Concern | Decision |
|---|---|
| Auth | Email **magic link** (`signInWithOtp`), passwordless |
| Game code lifecycle | **Regenerates every logout**: assigned at login, stable for the session, released (set null) on logout |
| Game code format | 6 chars, charset `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no ambiguous I/O/0/1/L) |
| Game code generation | Server-side Postgres `security definer` RPC `assign_game_code()`, atomic with retry on collision |
| Profile setup | Display name + **emoji avatar** from a preset set (no uploads, no storage bucket) |
| SP1 screen scope | Login, CheckEmail, AuthCallback, ProfileSetup, Home, Profile, HowToPlay |
| Routing | React Router + `AuthProvider` context + route guards |
| State | React context + hooks (no extra state library — YAGNI) |

Lobby/gameplay screens and cross-user game-code lookup are **out of scope** (SP2+).

## 3. File structure

```
src/
├─ main.tsx                  # wrap app in <BrowserRouter> + <AuthProvider>
├─ App.tsx                   # route table + guards
├─ auth/
│  ├─ AuthProvider.tsx       # context: session, profile, signIn(email), signOut(), refreshProfile()
│  ├─ useAuth.ts             # hook to consume the context
│  └─ guards.tsx             # <RequireAuth>, <RequireProfile>
├─ lib/
│  ├─ supabaseClient.ts      # (exists)
│  ├─ profile.ts             # getProfile, updateProfile, assignGameCode (RPC), clearGameCode (RPC)
│  └─ gameCode.ts            # pure format/validation helpers
├─ screens/
│  ├─ Login.tsx              ├─ CheckEmail.tsx        ├─ AuthCallback.tsx
│  ├─ ProfileSetup.tsx       ├─ Home.tsx              ├─ Profile.tsx
│  └─ HowToPlay.tsx
├─ data/avatars.ts           # preset emoji set
└─ components/               # existing Button/Card/ScreenBackground + new EmojiPicker, GameCodeBadge
```

**Boundaries:**
- `AuthProvider` is the only module touching `supabase.auth`; owns session + profile state.
- `lib/profile.ts` is the only module issuing profile DB/RPC calls.
- Screens are presentational — read from `useAuth()`, call `lib/profile.ts` actions.
- `gameCode.ts`, `EmojiPicker`, `GameCodeBadge` are pure/presentational and unit-tested without a DB.

## 4. Data model & server logic — migration `0006_profiles_auth.sql`

**A. RLS on `profiles` (owner-only):**
```sql
alter table profiles enable row level security;
create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);
```
Cross-user "find profile by game code" is deferred to SP2 with its own scoped RPC/policy.

**B. Auto-create a profile row per new auth user:**
```sql
create function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id) values (new.id);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
```

**C. Game-code uniqueness + generation:**
```sql
create unique index profiles_active_code_uniq on profiles (current_game_code)
  where current_game_code is not null;

create function assign_game_code() returns text language plpgsql security definer as $$
declare code text; chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    code := '';
    for i in 1..6 loop code := code || substr(chars, floor(random()*length(chars))::int + 1, 1); end loop;
    begin
      update profiles set current_game_code = code where id = auth.uid();
      return code;
    exception when unique_violation then -- collided, retry
    end;
  end loop;
end; $$;

create function clear_game_code() returns void language plpgsql security definer as $$
begin
  update profiles set current_game_code = null where id = auth.uid();
end; $$;
```

`assign_game_code`/`clear_game_code` are `security definer` and operate only on `auth.uid()`'s
row, so they're safe to expose to authenticated clients. Grant execute to `authenticated`.

## 5. Auth flow

```
/login  --enter email-->  signInWithOtp({ email, emailRedirectTo: <origin>/auth/callback })
   '------------------->  /check-email   (user taps the emailed link)
                                 v
                          /auth/callback   (supabase sets session from URL tokens)
                                 |
                  display_name empty? --yes--> /setup --save name+emoji--> assign code --> /home
                                 '----no----> ensure code assigned --> /home
```

**Route guards:** `<RequireAuth>` (no session → `/login`), `<RequireProfile>` (session but empty
`display_name` → `/setup`). Protected: `/home`, `/profile`, `/how-to-play`. Public: `/login`,
`/check-email`, `/auth/callback`.

**Session lifecycle (`AuthProvider`):**
- On mount: `getSession`, subscribe to `onAuthStateChange`, fetch profile when a session exists.
- `signIn(email)` → `signInWithOtp`.
- `signOut()` → `clear_game_code()` RPC → `supabase.auth.signOut()` → redirect `/login`.
- Code assignment is idempotent: assign only if the session's profile has no `current_game_code`.

**Error handling:**
- Expired/invalid magic link on `/auth/callback` → "link expired, request a new one" + button to `/login`.
- Email-send failure on `/login` → inline error, stay on page.
- Profile/RPC failure → toast + retry; never strand the user on a blank protected screen.

## 6. Screens & components

- **Login** — logo, email input, "Send me a link"; inline validation + send error.
- **CheckEmail** — confirmation with the email shown, resend link, spam note.
- **AuthCallback** — loading while session resolves; success routes onward, failure shows expired-link message.
- **ProfileSetup** — display-name input + `EmojiPicker`; "Let's play" saves, assigns code, → Home.
- **Home** — Hearts UP! title + nav: **Play** (placeholder → SP2), **My Profile**, **How to Play**; shows emoji + name.
- **Profile** — emoji + editable name, `GameCodeBadge` (code + copy + share), **Log out**.
- **HowToPlay** — static rules: 10/10-but premise, tilt up/down, modes.

**New components:** `EmojiPicker` (controlled, emits selected emoji), `GameCodeBadge` (shows code,
copy-to-clipboard, share). Both presentational + unit-testable.

## 7. Testing

- **Pure units (Vitest, no DB):** `gameCode.ts` format/validation; `data/avatars.ts` shape;
  `EmojiPicker` selection; `GameCodeBadge` copy (mock clipboard).
- **Auth context (mocked Supabase client):** guard redirect logic (no session → login; no name →
  setup); `signOut` calls `clear_game_code` then `signOut`. No network.
- **DB logic (integration, local Supabase):** `assign_game_code()` returns a 6-char code, is
  idempotent per session, enforces active-code uniqueness; RLS blocks reading another user's row.
- **Manual smoke (documented in plan):** full magic-link round-trip via local Mailpit inbox →
  setup → home → logout.

## 8. Out of scope / later
- Lobby create/join, cross-user game-code lookup → SP2.
- Real Figma token sync (tokens currently approximated from the export).
- Friends list / persistent contacts.
