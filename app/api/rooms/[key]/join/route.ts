import { roomRoute } from "@/lib/room/api-route.ts";
import { handleJoin } from "@/lib/room/handlers.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  return roomRoute(request, (deps, _caller, body) => handleJoin(deps, key, body));
}
