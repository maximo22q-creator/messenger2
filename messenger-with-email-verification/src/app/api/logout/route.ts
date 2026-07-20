import { destroySession } from "@/lib/session";

export async function POST() {
  await destroySession();
  return Response.json({ success: true });
}
