import { ScreenBackground } from "./components/ScreenBackground";
import { Button } from "./components/Button";

export default function App() {
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 48, margin: 0 }}>Hearts UP!</h1>
      <Button>START</Button>
    </ScreenBackground>
  );
}
