import { Game } from "@/components/game/game.tsx";

/*
 * The whole product is one screen, so this is the whole of the routing. The page stays a
 * server component and `Game` is the client leaf, which keeps the arena's canvas and its
 * pointer handling the only things that ship as client code.
 */
export default function Page() {
  return <Game />;
}
