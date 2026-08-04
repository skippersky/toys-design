import { describe, expect, it, vi } from "vitest";
import { ComfyUIClient } from "@/lib/comfyui-client";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.onclose?.();
  }

  emitOpen() {
    this.onopen?.();
  }

  emitClose() {
    this.onclose?.();
  }

  emitProgress(promptId: string, value: number, max: number) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "progress",
          data: {
            prompt_id: promptId,
            value,
            max,
          },
        }),
      }),
    );
  }
}

describe("ComfyUIClient reconnects WebSocket progress subscriptions", () => {
  it("reconnects after a close and continues delivering matching progress", async () => {
    MockWebSocket.instances = [];
    const progress = vi.fn();
    const delay = vi.fn(() => Promise.resolve());
    const client = new ComfyUIClient({
      httpUrl: "http://comfy.local",
      wsUrl: "ws://comfy.local",
      clientId: "client-1",
      createWebSocket: (url) => new MockWebSocket(url) as unknown as WebSocket,
      delay,
    });

    const unsubscribe = client.subscribeProgress("prompt-1", progress);

    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0]?.emitOpen();
    MockWebSocket.instances[0]?.emitClose();
    await Promise.resolve();

    expect(delay).toHaveBeenCalledWith(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1]?.emitProgress("prompt-1", 2, 4);

    expect(progress).toHaveBeenCalledWith({
      promptId: "prompt-1",
      step: 2,
      total: 4,
      node: undefined,
      completed: false,
    });

    unsubscribe();
  });
});
