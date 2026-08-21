import { roomRoute } from "@/lib/room/api-route.ts";
import { handleShot } from "@/lib/room/handlers.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  return roomRoute(request, (deps, _caller, body) => handleShot(deps, key, body));
}
