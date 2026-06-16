import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireProfile } from "./auth/guards";
import { Login } from "./screens/Login";
import { CheckEmail } from "./screens/CheckEmail";
import { AuthCallback } from "./screens/AuthCallback";
import { ProfileSetup } from "./screens/ProfileSetup";
import { Home } from "./screens/Home";
import { Profile } from "./screens/Profile";
import { HowToPlay } from "./screens/HowToPlay";

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
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
