import { getCampaignRuntime } from "@/src/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const runtime = await getCampaignRuntime();
  const encoder = new TextEncoder();
  const requestedSequence = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? 0);
  const previousEvents = await runtime.eventsAfter(Number.isSafeInteger(requestedSequence) && requestedSequence >= 0 ? requestedSequence : 0);
  let unsubscribe = () => {};
  const encodeEvent = (event: Awaited<ReturnType<typeof runtime.eventsAfter>>[number]) => encoder.encode(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
      previousEvents.forEach((event) => controller.enqueue(encodeEvent(event)));
      unsubscribe = runtime.subscribe((event) => {
        controller.enqueue(encodeEvent(event));
      });
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        controller.close();
      }, { once: true });
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}
