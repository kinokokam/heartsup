import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireProfile } from "./auth/guards";
import { Login } from "./screens/Login";
import { CheckEmail } from "./screens/CheckEmail";
import { AuthCallback } from "./screens/AuthCallback";
import { ProfileSetup } from "./screens/ProfileSetup";
import { Home } from "./screens/Home";
import { Profile } from "./screens/Profile";
import { HowToPlay } from "./screens/HowToPlay";
import { PlayMenu } from "./screens/PlayMenu";
import { CreateLobby } from "./screens/CreateLobby";
import { JoinLobby } from "./screens/JoinLobby";
import { LobbyRoom } from "./screens/LobbyRoom";
import { GamePlay } from "./screens/GamePlay";
import { Leaderboard } from "./screens/Leaderboard";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/check-email" element={<CheckEmail />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/setup" element={<RequireAuth><ProfileSetup /></RequireAuth>} />
      <Route path="/home" element={<RequireAuth><RequireProfile><Home /></RequireProfile></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><RequireProfile><Profile /></RequireProfile></RequireAuth>} />
      <Route path="/how-to-play" element={<RequireAuth><RequireProfile><HowToPlay /></RequireProfile></RequireAuth>} />
      <Route path="/play" element={<RequireAuth><RequireProfile><PlayMenu /></RequireProfile></RequireAuth>} />
      <Route path="/lobby/new" element={<RequireAuth><RequireProfile><CreateLobby /></RequireProfile></RequireAuth>} />
      <Route path="/lobby/join" element={<RequireAuth><RequireProfile><JoinLobby /></RequireProfile></RequireAuth>} />
      <Route path="/lobby/:id" element={<RequireAuth><RequireProfile><LobbyRoom /></RequireProfile></RequireAuth>} />
      <Route path="/game/:id" element={<RequireAuth><RequireProfile><GamePlay /></RequireProfile></RequireAuth>} />
      <Route path="/game/:id/results" element={<RequireAuth><RequireProfile><Leaderboard /></RequireProfile></RequireAuth>} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
