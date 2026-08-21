import { roomRoute, tokenOf } from "@/lib/room/api-route.ts";
import { handleRead } from "@/lib/room/handlers.ts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  return roomRoute(request, (deps) => handleRead(deps, key, tokenOf(request)));
}
