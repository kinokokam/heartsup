import { Link } from "react-router-dom";
import { ScreenBackground } from "../components/ScreenBackground";
import { Button } from "../components/Button";

export function PlayMenu() {
  return (
    <ScreenBackground>
      <h1 style={{ fontSize: 40, margin: 0 }}>Play</h1>
      <Link to="/lobby/new"><Button>Host a game</Button></Link>
      <Link to="/lobby/join"><Button>Join a game</Button></Link>
      <Link to="/home"><Button>Back</Button></Link>
    </ScreenBackground>
  );
}
