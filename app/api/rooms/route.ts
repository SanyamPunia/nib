import { roomRoute } from "@/lib/room/api-route.ts";
import { handleCreate } from "@/lib/room/handlers.ts";

export async function POST(request: Request): Promise<Response> {
  return roomRoute(request, (deps, caller, body) => handleCreate(deps, body, caller));
}
