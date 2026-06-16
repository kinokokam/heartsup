import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";
import { EmojiPicker } from "../components/EmojiPicker";
import { AVATARS } from "../data/avatars";
import { updateProfile, assignGameCode } from "../lib/profile";
import { useAuth } from "../auth/useAuth";
import { tokens } from "../theme/tokens";

export function ProfileSetup() {
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await updateProfile({ display_name: name.trim(), avatar });
    await assignGameCode();
    await refreshProfile();
    navigate("/home", { replace: true });
  };

  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 32, margin: 0 }}>Set up your profile</h1>
      <label htmlFor="name" style={{ fontWeight: tokens.font.weightBold }}>Name</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ padding: tokens.space[3], borderRadius: tokens.radius.md, border: "none", fontSize: 16, width: 240 }}
      />
      <EmojiPicker value={avatar} onChange={setAvatar} />
      <Button onClick={save} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Let’s play"}</Button>
    </ScreenBackground>
  );
}
