import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("selects and downloads the first generated preview from history", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ComfyUIClient({
      httpUrl: "http://comfy.local",
      wsUrl: "ws://comfy.local",
      clientId: "client-1",
    });
    const image = client.getFirstOutputImage(
      {
        "prompt-1": {
          prompt: [1, "prompt-1", {}, {}, []],
          outputs: {
            output: {
              images: [
                {
                  filename: "statue preview.png",
                  subfolder: "qa",
                  type: "output",
                },
              ],
            },
          },
          status: { status_str: "success", completed: true, messages: [] },
        },
      },
      "prompt-1",
    );

    expect(image).not.toBeNull();
    if (!image) {
      throw new Error("Expected a ComfyUI output image.");
    }

    await expect(client.downloadImage(image)).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://comfy.local/view?filename=statue+preview.png&subfolder=qa&type=output",
      ),
    );
  });

  it("rejects untyped queue responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ prompt: "missing id" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    const client = new ComfyUIClient({
      httpUrl: "http://comfy.local",
      wsUrl: "ws://comfy.local",
      clientId: "client-1",
    });

    await expect(client.queuePrompt({})).rejects.toThrow(
      "invalid queue response",
    );
  });

  it("removes queued work and interrupts active work on cancellation", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ComfyUIClient({
      httpUrl: "http://comfy.local",
      wsUrl: "ws://comfy.local",
      clientId: "client-1",
    });

    await client.cancelPrompt("prompt-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://comfy.local/queue"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ delete: ["prompt-1"] }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://comfy.local/interrupt"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
